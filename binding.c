#include <assert.h>
#include <bare.h>
#include <js.h>
#include <sqlite3.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <utf.h>
#include <uv.h>

static const char *PARAVFS = "paravfs";

typedef utf8_t paraql_path_t[4096];

typedef struct {
  sqlite3_vfs handle;

  js_env_t *env;
  js_ref_t *ctx;

  js_threadsafe_function_t *on_delete;
  js_threadsafe_function_t *on_access;
  js_threadsafe_function_t *on_read;
  js_threadsafe_function_t *on_write;
  js_threadsafe_function_t *on_truncate;
  js_threadsafe_function_t *on_sync;
  js_threadsafe_function_t *on_size;

  uv_sem_t done;
} paravfs_t;

typedef struct {
  sqlite3_file handle;

  paraql_path_t name;
  bool delete_on_close;

  paravfs_t *vfs;
} paravfs_file_t;

typedef struct {
  paravfs_file_t *file;

  void *buf;
  int len;
  int64_t offset;

  int status;
} paravfs_read_t;

typedef struct {
  paravfs_file_t *file;

  const void *buf;
  int len;
  int64_t offset;

  int status;
} paravfs_write_t;

typedef struct {
  paravfs_file_t *file;

  int64_t size;

  int status;
} paravfs_truncate_t;

typedef struct {
  paravfs_file_t *file;

  int status;
} paravfs_sync_t;

typedef struct {
  paravfs_file_t *file;

  int64_t size;

  int status;
} paravfs_size_t;

typedef struct {
  paravfs_t *vfs;

  const char *name;
  bool exists;

  int status;
} paravfs_access_t;

typedef struct {
  paravfs_t *vfs;

  const char *name;

  int status;
} paravfs_delete_t;

typedef struct {
  sqlite3 *handle;

  js_env_t *env;
} paraql_t;

typedef struct {
  uv_work_t handle;

  paraql_t *db;

  js_deferred_t *deferred;

  paraql_path_t name;

  js_ref_t *result;

  int errcode;
  const char *errmsg;
} paraql_open_t;

typedef struct {
  uv_work_t handle;

  paraql_t *db;

  js_deferred_t *deferred;

  int errcode;
  const char *errmsg;
} paraql_close_t;

typedef struct {
  uv_work_t handle;

  paraql_t *db;

  js_deferred_t *deferred;

  utf8_t *sql;

  int errcode;
  const char *errmsg;
} paraql_exec_t;

static const size_t paraql__queue_limit = 64;

static int
paravfs__error_from(js_env_t *env, js_value_t *value, int code) {
  int err;

  js_value_type_t type;
  err = js_typeof(env, value, &type);
  assert(err == 0);

  if (type == js_null || type == js_undefined) return SQLITE_OK;

  return code;
}

static void
paravfs__temporary_name(char *out, size_t len) {
  int err;

  char *hex = out;
  size_t buflen = len / 2;
  uint8_t buffer[buflen];

  err = uv_random(NULL, NULL, (void *) buffer, buflen, 0, NULL);
  assert(err == 0);

  for (int i = 0; i < buflen; i++) {
    hex += sprintf(hex, "%02X", buffer[i]);
  }
}

static int
paravfs__on_close(sqlite3_file *handle) {
  paravfs_file_t *file = (paravfs_file_t *) handle;

  if (file->delete_on_close) {
    return file->vfs->handle.xDelete((sqlite3_vfs *) file->vfs, (const char *) file->name, 0);
  }

  return SQLITE_OK;
}

static js_value_t *
paravfs__on_read_done(js_env_t *env, js_callback_info_t *info) {
  int err;

  paravfs_read_t *data;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, (void **) &data);
  assert(err == 0);

  assert(argc == 1);

  data->status = paravfs__error_from(env, argv[0], SQLITE_IOERR_READ);

  uv_sem_post(&data->file->vfs->done);

  return NULL;
}

static void
paravfs__on_read_call(js_env_t *env, js_value_t *on_read, void *context, void *arg) {
  int err;

  paravfs_t *vfs = (paravfs_t *) context;

  paravfs_read_t *data = (paravfs_read_t *) arg;

  js_value_t *ctx;
  err = js_get_reference_value(env, vfs->ctx, &ctx);
  assert(err == 0);

  js_value_t *args[4];

  err = js_create_string_utf8(env, data->file->name, -1, &args[0]);
  assert(err == 0);

  err = js_create_external_arraybuffer(env, data->buf, data->len, NULL, NULL, &args[1]);
  assert(err == 0);

  err = js_create_int64(env, data->offset, &args[2]);
  assert(err == 0);

  err = js_create_function(env, "done", -1, paravfs__on_read_done, (void *) data, &args[3]);
  assert(err == 0);

  err = js_call_function(env, ctx, on_read, 4, args, NULL);
  assert(err == 0);
}

static int
paravfs__on_read(sqlite3_file *handle, void *buf, int len, sqlite3_int64 offset) {
  int err;

  paravfs_file_t *file = (paravfs_file_t *) handle;

  paravfs_t *vfs = file->vfs;

  paravfs_read_t data = {
    file,
    buf,
    len,
    offset,
  };

  err = js_call_threadsafe_function(vfs->on_read, (void *) &data, js_threadsafe_function_blocking);
  assert(err == 0);

  uv_sem_wait(&vfs->done);

  return data.status;
}

static js_value_t *
paravfs__on_write_done(js_env_t *env, js_callback_info_t *info) {
  int err;

  paravfs_write_t *data;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, (void **) &data);
  assert(err == 0);

  assert(argc == 1);

  data->status = paravfs__error_from(env, argv[0], SQLITE_IOERR_WRITE);

  uv_sem_post(&data->file->vfs->done);

  return NULL;
}

static void
paravfs__on_write_call(js_env_t *env, js_value_t *on_write, void *context, void *arg) {
  int err;

  paravfs_t *vfs = (paravfs_t *) context;

  paravfs_write_t *data = (paravfs_write_t *) arg;

  js_value_t *ctx;
  err = js_get_reference_value(env, vfs->ctx, &ctx);
  assert(err == 0);

  js_value_t *args[4];

  err = js_create_string_utf8(env, data->file->name, -1, &args[0]);
  assert(err == 0);

  err = js_create_external_arraybuffer(env, (void *) data->buf, data->len, NULL, NULL, &args[1]);
  assert(err == 0);

  err = js_create_int64(env, data->offset, &args[2]);
  assert(err == 0);

  err = js_create_function(env, "done", -1, paravfs__on_write_done, (void *) data, &args[3]);
  assert(err == 0);

  err = js_call_function(env, ctx, on_write, 4, args, NULL);
  assert(err == 0);
}

static int
paravfs__on_write(sqlite3_file *handle, const void *buf, int len, sqlite3_int64 offset) {
  int err;

  paravfs_file_t *file = (paravfs_file_t *) handle;

  paravfs_t *vfs = file->vfs;

  paravfs_write_t data = {
    file,
    buf,
    len,
    offset,
  };

  err = js_call_threadsafe_function(vfs->on_write, (void *) &data, js_threadsafe_function_blocking);
  assert(err == 0);

  uv_sem_wait(&vfs->done);

  return data.status;
}

static js_value_t *
paravfs__on_truncate_done(js_env_t *env, js_callback_info_t *info) {
  int err;

  paravfs_truncate_t *data;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, (void **) &data);
  assert(err == 0);

  assert(argc == 1);

  data->status = paravfs__error_from(env, argv[0], SQLITE_IOERR);

  uv_sem_post(&data->file->vfs->done);

  return NULL;
}

static void
paravfs__on_truncate_call(js_env_t *env, js_value_t *on_truncate, void *context, void *arg) {
  int err;

  paravfs_t *vfs = (paravfs_t *) context;

  paravfs_truncate_t *data = (paravfs_truncate_t *) arg;

  js_value_t *ctx;
  err = js_get_reference_value(env, vfs->ctx, &ctx);
  assert(err == 0);

  js_value_t *args[3];

  err = js_create_string_utf8(env, data->file->name, -1, &args[0]);
  assert(err == 0);

  err = js_create_int64(env, data->size, &args[1]);
  assert(err == 0);

  err = js_create_function(env, "done", -1, paravfs__on_truncate_done, (void *) data, &args[2]);
  assert(err == 0);

  err = js_call_function(env, ctx, on_truncate, 3, args, NULL);
  assert(err == 0);
}

static int
paravfs__on_truncate(sqlite3_file *handle, sqlite3_int64 size) {
  int err;

  paravfs_file_t *file = (paravfs_file_t *) handle;

  paravfs_t *vfs = file->vfs;

  paravfs_truncate_t data = {
    file,
    size,
  };

  err = js_call_threadsafe_function(vfs->on_truncate, (void *) &data, js_threadsafe_function_blocking);
  assert(err == 0);

  uv_sem_wait(&vfs->done);

  return data.status;
}

static js_value_t *
paravfs__on_sync_done(js_env_t *env, js_callback_info_t *info) {
  int err;

  paravfs_sync_t *data;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, (void **) &data);
  assert(err == 0);

  assert(argc == 1);

  data->status = paravfs__error_from(env, argv[0], SQLITE_IOERR);

  uv_sem_post(&data->file->vfs->done);

  return NULL;
}

static void
paravfs__on_sync_call(js_env_t *env, js_value_t *on_sync, void *context, void *arg) {
  int err;

  paravfs_t *vfs = (paravfs_t *) context;

  paravfs_sync_t *data = (paravfs_sync_t *) arg;

  js_value_t *ctx;
  err = js_get_reference_value(env, vfs->ctx, &ctx);
  assert(err == 0);

  js_value_t *args[2];

  err = js_create_string_utf8(env, data->file->name, -1, &args[0]);
  assert(err == 0);

  err = js_create_function(env, "done", -1, paravfs__on_sync_done, (void *) data, &args[1]);
  assert(err == 0);

  err = js_call_function(env, ctx, on_sync, 2, args, NULL);
  assert(err == 0);
}

static int
paravfs__on_sync(sqlite3_file *handle, int flags) {
  int err;

  paravfs_file_t *file = (paravfs_file_t *) handle;

  paravfs_t *vfs = file->vfs;

  paravfs_sync_t data = {
    file,
  };

  err = js_call_threadsafe_function(vfs->on_sync, (void *) &data, js_threadsafe_function_blocking);
  assert(err == 0);

  uv_sem_wait(&vfs->done);

  return data.status;
}

static js_value_t *
paravfs__on_size_done(js_env_t *env, js_callback_info_t *info) {
  int err;

  paravfs_size_t *data;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, (void **) &data);
  assert(err == 0);

  assert(argc >= 1);

  data->status = paravfs__error_from(env, argv[0], SQLITE_IOERR_FSTAT);

  if (data->status == SQLITE_OK) {
    assert(argc == 2);

    err = js_get_value_int64(env, argv[1], &data->size);
    assert(err == 0);
  }

  uv_sem_post(&data->file->vfs->done);

  return NULL;
}

static void
paravfs__on_size_call(js_env_t *env, js_value_t *on_size, void *context, void *arg) {
  int err;

  paravfs_t *vfs = (paravfs_t *) context;

  paravfs_size_t *data = (paravfs_size_t *) arg;

  js_value_t *ctx;
  err = js_get_reference_value(env, vfs->ctx, &ctx);
  assert(err == 0);

  js_value_t *args[2];

  err = js_create_string_utf8(env, data->file->name, -1, &args[0]);
  assert(err == 0);

  err = js_create_function(env, "done", -1, paravfs__on_size_done, (void *) data, &args[1]);
  assert(err == 0);

  err = js_call_function(env, ctx, on_size, 2, args, NULL);
  assert(err == 0);
}

static int
paravfs__on_size(sqlite3_file *handle, sqlite3_int64 *size) {
  int err;

  paravfs_file_t *file = (paravfs_file_t *) handle;

  paravfs_t *vfs = file->vfs;

  paravfs_size_t data = {
    file,
  };

  err = js_call_threadsafe_function(vfs->on_size, (void *) &data, js_threadsafe_function_blocking);
  assert(err == 0);

  uv_sem_wait(&vfs->done);

  if (data.status != SQLITE_OK) return data.status;

  *size = data.size;

  return SQLITE_OK;
}

static int
paravfs__on_lock(sqlite3_file *handle, int eLock) {
  return SQLITE_OK;
}

static int
paravfs__on_unlock(sqlite3_file *handle, int eLock) {
  return SQLITE_OK;
}

static int
paravfs__on_check_reserved_lock(sqlite3_file *handle, int *pResOut) {
  *pResOut = 0;
  return SQLITE_OK;
}

static int
paravfs__on_control(sqlite3_file *handle, int op, void *pArg) {
  return SQLITE_NOTFOUND;
}

static int
paravfs__on_sector_size(sqlite3_file *handle) {
  return 512;
}

static int
paravfs__on_device_characteristics(sqlite3_file *handle) {
  return 0;
}

static int
paravfs__on_open(sqlite3_vfs *vfs_handle, const char *name, sqlite3_file *handle, int flags, int *pflags) {
  paravfs_t *vfs = (paravfs_t *) vfs_handle;

  paravfs_file_t *file = (paravfs_file_t *) handle;

  if (name != NULL) {
    strcpy((char *) file->name, name);
  } else {
    paravfs__temporary_name((char *) file->name, 32);
  }

  file->delete_on_close = flags & SQLITE_OPEN_DELETEONCLOSE;
  file->vfs = (paravfs_t *) vfs;

  static const sqlite3_io_methods methods = {
    1, // Version
    paravfs__on_close,
    paravfs__on_read,
    paravfs__on_write,
    paravfs__on_truncate,
    paravfs__on_sync,
    paravfs__on_size,
    paravfs__on_lock,
    paravfs__on_unlock,
    paravfs__on_check_reserved_lock,
    paravfs__on_control,
    paravfs__on_sector_size,
    paravfs__on_device_characteristics,
  };

  file->handle.pMethods = &methods;

  return SQLITE_OK;
}

static js_value_t *
paravfs__on_delete_done(js_env_t *env, js_callback_info_t *info) {
  int err;

  paravfs_delete_t *data;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, (void **) &data);
  assert(err == 0);

  assert(argc == 1);

  data->status = paravfs__error_from(env, argv[0], SQLITE_IOERR_DELETE);

  uv_sem_post(&data->vfs->done);

  return NULL;
}

static void
paravfs__on_delete_call(js_env_t *env, js_value_t *on_delete, void *context, void *arg) {
  int err;

  paravfs_t *vfs = (paravfs_t *) context;

  paravfs_delete_t *data = (paravfs_delete_t *) arg;

  js_value_t *ctx;
  err = js_get_reference_value(env, vfs->ctx, &ctx);
  assert(err == 0);

  js_value_t *args[2];

  err = js_create_string_utf8(env, (utf8_t *) data->name, -1, &args[0]);
  assert(err == 0);

  err = js_create_function(env, "done", -1, paravfs__on_delete_done, (void *) data, &args[1]);
  assert(err == 0);

  err = js_call_function(env, ctx, on_delete, 2, args, NULL);
  assert(err == 0);
}

static int
paravfs__on_delete(sqlite3_vfs *handle, const char *name, int sync) {
  int err;

  paravfs_t *vfs = (paravfs_t *) handle;

  paravfs_delete_t data = {
    vfs,
    name,
    sync,
  };

  err = js_call_threadsafe_function(vfs->on_delete, (void *) &data, js_threadsafe_function_blocking);
  assert(err == 0);

  uv_sem_wait(&vfs->done);

  return data.status;
}

static js_value_t *
paravfs__on_access_done(js_env_t *env, js_callback_info_t *info) {
  int err;

  paravfs_access_t *data;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, (void **) &data);
  assert(err == 0);

  assert(argc >= 1);

  data->status = paravfs__error_from(env, argv[0], SQLITE_IOERR_ACCESS);

  if (data->status == SQLITE_OK) {
    assert(argc == 2);

    err = js_get_value_bool(env, argv[1], &data->exists);
    assert(err == 0);
  }

  uv_sem_post(&data->vfs->done);

  return NULL;
}

static void
paravfs__on_access_call(js_env_t *env, js_value_t *on_access, void *context, void *arg) {
  int err;

  paravfs_t *vfs = (paravfs_t *) context;

  paravfs_access_t *data = (paravfs_access_t *) arg;

  js_value_t *ctx;
  err = js_get_reference_value(env, vfs->ctx, &ctx);
  assert(err == 0);

  js_value_t *args[2];

  err = js_create_string_utf8(env, (utf8_t *) data->name, -1, &args[0]);
  assert(err == 0);

  err = js_create_function(env, "done", -1, paravfs__on_access_done, (void *) data, &args[1]);
  assert(err == 0);

  err = js_call_function(env, ctx, on_access, 2, args, NULL);
  assert(err == 0);
}

static int
paravfs__on_access(sqlite3_vfs *handle, const char *name, int flags, int *exists) {
  int err;

  paravfs_t *vfs = (paravfs_t *) handle;

  paravfs_access_t data = {
    vfs,
    name,
    flags,
  };

  err = js_call_threadsafe_function(vfs->on_access, (void *) &data, js_threadsafe_function_blocking);
  assert(err == 0);

  uv_sem_wait(&vfs->done);

  if (data.status != SQLITE_OK) return data.status;

  *exists = data.exists;

  return SQLITE_OK;
}

static int
paravfs__on_fullpathname(sqlite3_vfs *vfs, const char *name, int len, char *out) {
  if (strlen(name) >= len) return SQLITE_ERROR;

  strcpy(out, name);

  return SQLITE_OK;
}

static void *
paravfs__on_dlopen(sqlite3_vfs *vfs, const char *path) {
  return NULL;
}

static int
paravfs__on_randomness(sqlite3_vfs *vfs, int bytes, char *buf) {
  memset(buf, 0, bytes);

  return 0;
}

static int
paravfs__on_sleep(sqlite3_vfs *vfs, int nMicro) {
  return SQLITE_OK;
}

static int
paravfs__on_current_time(sqlite3_vfs *vfs, double *time) {
  int err;

  uv_timespec64_t ts;
  err = uv_clock_gettime(UV_CLOCK_REALTIME, &ts);
  assert(err == 0);

  *time = ts.tv_sec / 86400.0 + 2440587.5;

  return SQLITE_OK;
}

static js_value_t *
paravfs_init(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 8;
  js_value_t *argv[8];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 8);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  js_value_t *handle;

  paravfs_t *vfs;
  err = js_create_arraybuffer(env, sizeof(paravfs_t), (void **) &vfs, &handle);
  assert(err == 0);

  err = uv_sem_init(&vfs->done, 0);
  assert(err == 0);

  vfs->env = env;

  err = js_create_reference(env, argv[0], 1, &vfs->ctx);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[1], paraql__queue_limit, 1, NULL, NULL, (void *) vfs, paravfs__on_delete_call, &vfs->on_delete);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[2], paraql__queue_limit, 1, NULL, NULL, (void *) vfs, paravfs__on_access_call, &vfs->on_access);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[3], paraql__queue_limit, 1, NULL, NULL, (void *) vfs, paravfs__on_read_call, &vfs->on_read);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[4], paraql__queue_limit, 1, NULL, NULL, (void *) vfs, paravfs__on_write_call, &vfs->on_write);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[5], paraql__queue_limit, 1, NULL, NULL, (void *) vfs, paravfs__on_truncate_call, &vfs->on_truncate);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[6], paraql__queue_limit, 1, NULL, NULL, (void *) vfs, paravfs__on_sync_call, &vfs->on_sync);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[7], paraql__queue_limit, 1, NULL, NULL, (void *) vfs, paravfs__on_size_call, &vfs->on_size);
  assert(err == 0);

  vfs->handle = (sqlite3_vfs) {
    1, // Version
    sizeof(paravfs_file_t),
    sizeof(paraql_path_t),
    NULL,
    PARAVFS,
    NULL,
    paravfs__on_open,
    paravfs__on_delete,
    paravfs__on_access,
    paravfs__on_fullpathname,
    paravfs__on_dlopen,
    NULL, // dlerror
    NULL, // dlsym
    NULL, // dlclose
    paravfs__on_randomness,
    paravfs__on_sleep,
    paravfs__on_current_time,
  };

  err = sqlite3_vfs_register(&vfs->handle, false);
  assert(err == 0);

  return handle;
}

static js_value_t *
paravfs_destroy(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  paravfs_t *vfs;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &vfs, NULL);
  assert(err == 0);

  err = sqlite3_vfs_unregister(&vfs->handle);
  assert(err == 0);

  err = js_release_threadsafe_function(vfs->on_delete, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(vfs->on_access, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(vfs->on_read, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(vfs->on_write, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(vfs->on_truncate, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(vfs->on_sync, js_threadsafe_function_release);
  assert(err == 0);

  err = js_release_threadsafe_function(vfs->on_size, js_threadsafe_function_release);
  assert(err == 0);

  err = js_delete_reference(env, vfs->ctx);
  assert(err == 0);

  uv_sem_destroy(&vfs->done);

  return NULL;
}

static const char *
paraql__code(int errcode) {
  switch (errcode & 0xff) {
#define V(name) \
  case SQLITE_##name: \
    return #name;
    V(ERROR)
    V(INTERNAL)
    V(PERM)
    V(ABORT)
    V(BUSY)
    V(LOCKED)
    V(NOMEM)
    V(READONLY)
    V(INTERRUPT)
    V(IOERR)
    V(CORRUPT)
    V(NOTFOUND)
    V(FULL)
    V(CANTOPEN)
    V(PROTOCOL)
    V(EMPTY)
    V(SCHEMA)
    V(TOOBIG)
    V(CONSTRAINT)
    V(MISMATCH)
    V(MISUSE)
    V(NOLFS)
    V(AUTH)
    V(FORMAT)
    V(RANGE)
    V(NOTADB)
    V(NOTICE)
    V(WARNING)
#undef V
  default:
    return "ERROR";
  }
}

static int
paraql__make_error(js_env_t *env, int errcode, const char *errmsg, js_value_t **error) {
  int err;

  js_value_t *code;
  err = js_create_string_utf8(env, (utf8_t *) paraql__code(errcode), -1, &code);
  assert(err == 0);

  js_value_t *message;
  err = js_create_string_utf8(env, (utf8_t *) errmsg, -1, &message);
  assert(err == 0);

  return js_create_error(env, code, message, error);
}

static void
paraql__on_after_open(uv_work_t *handle, int status) {
  int err;

  paraql_open_t *req = (paraql_open_t *) handle->data;

  paraql_t *db = req->db;

  js_env_t *env = db->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  if (req->errcode) {
    js_value_t *error;
    err = paraql__make_error(env, req->errcode, req->errmsg, &error);
    assert(err == 0);

    err = js_reject_deferred(env, req->deferred, error);
    assert(err == 0);
  } else {
    js_value_t *result;
    err = js_get_reference_value(env, req->result, &result);
    assert(err == 0);

    err = js_resolve_deferred(env, req->deferred, result);
    assert(err == 0);
  }

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  err = js_delete_reference(env, req->result);
  assert(err == 0);

  free(req);
}

static void
paraql__on_before_open(uv_work_t *handle) {
  paraql_open_t *req = (paraql_open_t *) handle->data;

  paraql_t *db = req->db;

  int status = sqlite3_open_v2((char *) req->name, &db->handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, PARAVFS);

  if (status != SQLITE_OK) {
    const char *errmsg = db->handle != NULL ? sqlite3_errmsg(db->handle) : sqlite3_errstr(status);

    req->errcode = status;
    req->errmsg = errmsg;

    if (db->handle != NULL) sqlite3_close_v2(db->handle);
  }
}

static js_value_t *
paraql_open(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_path_t name;
  err = js_get_value_string_utf8(env, argv[0], name, sizeof(name), NULL);
  assert(err == 0);

  paraql_open_t *req = malloc(sizeof(paraql_open_t));

  req->errcode = 0;

  js_value_t *handle;

  err = js_create_arraybuffer(env, sizeof(paraql_t), (void **) &req->db, &handle);
  assert(err == 0);

  req->db->env = env;

  memcpy(req->name, name, sizeof(name));

  req->handle.data = (void *) req;

  err = js_create_reference(env, handle, 1, &req->result);

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_open, paraql__on_after_open);
  assert(err == 0);

  return promise;
}

static void
paraql__on_after_close(uv_work_t *handle, int status) {
  int err;

  paraql_close_t *req = (paraql_close_t *) handle->data;

  paraql_t *db = req->db;

  js_env_t *env = db->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  if (req->errcode) {
    js_value_t *error;
    err = paraql__make_error(env, req->errcode, req->errmsg, &error);
    assert(err == 0);

    err = js_reject_deferred(env, req->deferred, error);
    assert(err == 0);
  } else {
    js_value_t *result;
    err = js_get_undefined(env, &result);
    assert(err == 0);

    err = js_resolve_deferred(env, req->deferred, result);
    assert(err == 0);
  }

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  free(req);
}

static void
paraql__on_before_close(uv_work_t *handle) {
  paraql_close_t *req = (paraql_close_t *) handle->data;

  paraql_t *db = req->db;

  int status = sqlite3_close_v2(req->db->handle);

  if (status != SQLITE_OK) {
    req->errcode = status;
    req->errmsg = sqlite3_errmsg(db->handle);

    return;
  }

  db->handle = NULL;
}

static js_value_t *
paraql_close(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_close_t *req = malloc(sizeof(paraql_close_t));

  req->errcode = 0;

  err = js_get_arraybuffer_info(env, argv[0], (void **) &req->db, NULL);
  assert(err == 0);

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_close, paraql__on_after_close);
  assert(err == 0);

  return promise;
}

static void
paraql__on_after_exec(uv_work_t *handle, int status) {
  int err;

  paraql_exec_t *req = (paraql_exec_t *) handle->data;

  paraql_t *db = req->db;

  js_env_t *env = db->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  if (req->errcode) {
    js_value_t *error;
    err = paraql__make_error(env, req->errcode, req->errmsg, &error);
    assert(err == 0);

    err = js_reject_deferred(env, req->deferred, error);
    assert(err == 0);
  }
  {
    js_value_t *result;
    err = js_get_undefined(env, &result);
    assert(err == 0);

    err = js_resolve_deferred(env, req->deferred, result);
    assert(err == 0);
  }

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  free(req);
}

static void
paraql__on_before_exec(uv_work_t *handle) {
  paraql_exec_t *req = (paraql_exec_t *) handle->data;

  paraql_t *db = (paraql_t *) req->db;

  const char *cursor = (const char *) req->sql;

  while (*cursor != '\0') {
    sqlite3_stmt *stmt = NULL;
    const char *tail;
    int status = sqlite3_prepare_v2(db->handle, cursor, -1, &stmt, &tail);

    if (status != SQLITE_OK) {
      req->errcode = status;
      req->errmsg = sqlite3_errmsg(db->handle);

      if (stmt != NULL) sqlite3_finalize(stmt);

      free(req->sql);
      return;
    }

    cursor = tail;

    if (stmt == NULL) continue;

    while ((status = sqlite3_step(stmt)) == SQLITE_ROW) {
    }

    sqlite3_finalize(stmt);

    if (status != SQLITE_DONE) {
      req->errcode = status;
      req->errmsg = sqlite3_errmsg(db->handle);

      free(req->sql);
      return;
    }
  }

  free(req->sql);
}

static js_value_t *
paraql_exec(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_t *db;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &db, NULL);
  assert(err == 0);

  size_t sql_len;
  err = js_get_value_string_utf8(env, argv[1], NULL, 0, &sql_len);
  assert(err == 0);

  sql_len += 1; // NULL

  utf8_t *sql = (utf8_t *) malloc(sql_len);

  err = js_get_value_string_utf8(env, argv[1], sql, sql_len, NULL);
  assert(err == 0);

  paraql_exec_t *req = malloc(sizeof(paraql_exec_t));

  req->errcode = 0;
  req->db = db;
  req->sql = sql;

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_exec, paraql__on_after_exec);
  assert(err == 0);

  return promise;
}

static js_value_t *
paraql_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("vfsInit", paravfs_init)
  V("vfsDestroy", paravfs_destroy)

  V("open", paraql_open)
  V("close", paraql_close)
  V("exec", paraql_exec)
#undef V

  return exports;
}

BARE_MODULE(paraql, paraql_exports)
