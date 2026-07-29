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

static const char *STMT_FINALIZED = "Statement has already been finalized";

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

typedef struct paraql_statement_s paraql_statement_t;

typedef struct {
  sqlite3 *handle;

  js_env_t *env;

  paraql_statement_t *statements;
} paraql_t;

struct paraql_statement_s {
  sqlite3_stmt *handle;

  paraql_t *db;
  paraql_statement_t *prev;
  paraql_statement_t *next;
};

typedef struct {
  uv_work_t handle;

  paraql_t *db;

  js_deferred_t *deferred;

  paraql_path_t name;

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

typedef struct {
  uv_work_t handle;

  paraql_t *db;

  js_deferred_t *deferred;

  utf8_t *sql;

  paraql_statement_t *stmt;

  int errcode;
  const char *errmsg;
} paraql_prepare_t;

typedef struct {
  uv_work_t handle;

  js_env_t *env;

  js_deferred_t *deferred;

  paraql_statement_t *stmt;
} paraql_finalize_t;

typedef struct {
  uv_work_t handle;

  js_env_t *env;

  js_deferred_t *deferred;

  paraql_statement_t *stmt;

  int errcode;
  const char *errmsg;
} paraql_reset_t;

typedef struct {
  js_value_type_t type;

  bool is_double;

  union {
    struct {
      size_t len;
      void *data;
    } buffer;
    double d;
    int64_t i;
  } value;
} paraql_bind_value_t;

typedef struct {
  uv_work_t handle;

  js_env_t *env;

  js_deferred_t *deferred;

  js_ref_t *named;
  js_ref_t *positional;

  paraql_statement_t *stmt;

  int param_count;
  const char **param_names;
  paraql_bind_value_t **values;

  int errcode;
  const char *errmsg;
} paraql_bind_t;

typedef struct {
  int type;

  const char *name;

  union {
    struct {
      size_t len;
      const void *data;
    } buffer;
    double d;
    int64_t i;
  } value;
} paraql_step_value_t;

typedef struct {
  uv_work_t handle;

  js_env_t *env;

  js_deferred_t *deferred;

  paraql_statement_t *stmt;

  bool done;
  int count;
  paraql_step_value_t *values;

  int errcode;
  const char *errmsg;
} paraql_step_t;

typedef struct {
  uv_work_t handle;

  js_env_t *env;

  js_deferred_t *deferred;

  paraql_statement_t *stmt;

  int64_t changes;
  int64_t last_insert_rowid;

  int errcode;
  const char *errmsg;
} paraql_run_t;

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

static void
paraql__insert_statement(paraql_t *db, paraql_statement_t *stmt) {
  stmt->db = db;
  stmt->prev = NULL;
  stmt->next = db->statements;

  if (db->statements != NULL) db->statements->prev = stmt;

  db->statements = stmt;
}

static void
paraql__remove_statement(paraql_statement_t *stmt) {
  if (stmt->db == NULL) return;

  if (stmt->prev != NULL) stmt->prev->next = stmt->next;
  else stmt->db->statements = stmt->next;

  if (stmt->next != NULL) stmt->next->prev = stmt->prev;

  stmt->db = NULL;
  stmt->prev = NULL;
  stmt->next = NULL;
}

static void
paraql__finalize_statements(paraql_t *db) {
  paraql_statement_t *stmt = db->statements;

  while (stmt != NULL) {
    paraql_statement_t *next = stmt->next;

    if (stmt->handle != NULL) {
      sqlite3_finalize(stmt->handle);
      stmt->handle = NULL;
    }

    stmt->db = NULL;
    stmt->prev = NULL;
    stmt->next = NULL;

    stmt = next;
  }

  db->statements = NULL;
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
paraql__on_after_finalize_db(uv_work_t *handle, int status) {
  free(handle);
}

static void
paraql__on_before_finalize_db(uv_work_t *handle) {
  paraql_t *db = (paraql_t *) handle->data;

  paraql__finalize_statements(db);

  if (db->handle != NULL) sqlite3_close_v2(db->handle);

  free(db);
}

static void
paraql__on_finalize_db(js_env_t *env, void *data, void *hint) {
  int err;

  paraql_t *db = (paraql_t *) data;

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  uv_work_t *handle = malloc(sizeof(uv_work_t));

  handle->data = (void *) db;

  err = uv_queue_work(loop, handle, paraql__on_before_finalize_db, paraql__on_after_finalize_db);
  assert(err == 0);
}

static void
paraql__on_after_finalize_statement(uv_work_t *handle, int status) {
  free(handle);
}

static void
paraql__on_before_finalize_statement(uv_work_t *handle) {
  paraql_statement_t *stmt = (paraql_statement_t *) handle->data;

  if (stmt->handle != NULL) sqlite3_finalize(stmt->handle);

  paraql__remove_statement(stmt);

  free(stmt);
}

static void
paraql__on_finalize_statement(js_env_t *env, void *data, void *hint) {
  int err;

  paraql_statement_t *stmt = (paraql_statement_t *) data;

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  uv_work_t *handle = malloc(sizeof(uv_work_t));

  handle->data = stmt;

  err = uv_queue_work(loop, handle, paraql__on_before_finalize_statement, paraql__on_after_finalize_statement);
  assert(err == 0);
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
    err = js_create_external(env, db, paraql__on_finalize_db, NULL, &result);
    assert(err == 0);

    err = js_resolve_deferred(env, req->deferred, result);
    assert(err == 0);
  }

  err = js_close_handle_scope(env, scope);
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

  paraql_t *db = malloc(sizeof(paraql_t));

  db->env = env;
  db->statements = NULL;

  paraql_open_t *req = malloc(sizeof(paraql_open_t));

  req->db = db;
  req->errcode = 0;
  req->db->env = env;

  memcpy(req->name, name, sizeof(name));

  req->handle.data = (void *) req;

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

  err = js_get_value_external(env, argv[0], (void **) &req->db);
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
paraql__on_before_exec(uv_work_t *handle) {
  paraql_exec_t *req = (paraql_exec_t *) handle->data;

  paraql_t *db = req->db;

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
  err = js_get_value_external(env, argv[0], (void **) &db);
  assert(err == 0);

  size_t sql_len;
  err = js_get_value_string_utf8(env, argv[1], NULL, 0, &sql_len);
  assert(err == 0);

  sql_len += 1; // NULL

  utf8_t *sql = malloc(sql_len);

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

static void
paraql__on_after_prepare(uv_work_t *handle, int status) {
  int err;

  paraql_prepare_t *req = (paraql_prepare_t *) handle->data;

  paraql_t *db = req->db;

  js_env_t *env = db->env;

  paraql_statement_t *stmt = req->stmt;

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
    err = js_create_external(env, stmt, paraql__on_finalize_statement, NULL, &result);
    assert(err == 0);

    err = js_resolve_deferred(env, req->deferred, result);
    assert(err == 0);
  }

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  free(req);
}

static void
paraql__on_before_prepare(uv_work_t *handle) {
  paraql_prepare_t *req = (paraql_prepare_t *) handle->data;

  paraql_t *db = req->db;

  paraql_statement_t *stmt = malloc(sizeof(paraql_statement_t));

  int status = sqlite3_prepare_v2(db->handle, (const char *) req->sql, -1, &stmt->handle, NULL);

  free(req->sql);

  if (status != SQLITE_OK) {
    req->errcode = status;
    req->errmsg = sqlite3_errmsg(db->handle);

    if (stmt->handle != NULL) sqlite3_finalize(stmt->handle);

    return;
  }

  paraql__insert_statement(db, stmt);

  req->stmt = stmt;
}

static js_value_t *
paraql_prepare(js_env_t *env, js_callback_info_t *info) {
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
  err = js_get_value_external(env, argv[0], (void **) &db);
  assert(err == 0);

  size_t sql_len;
  err = js_get_value_string_utf8(env, argv[1], NULL, 0, &sql_len);
  assert(err == 0);

  sql_len += 1;

  utf8_t *sql = malloc(sql_len);

  err = js_get_value_string_utf8(env, argv[1], sql, sql_len, NULL);
  assert(err == 0);

  paraql_prepare_t *req = malloc(sizeof(paraql_prepare_t));

  req->errcode = 0;
  req->db = db;
  req->sql = sql;

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_prepare, paraql__on_after_prepare);
  assert(err == 0);

  return promise;
}

static void
paraql__on_after_finalize(uv_work_t *handle, int status) {
  int err;

  paraql_finalize_t *req = (paraql_finalize_t *) handle->data;

  js_env_t *env = req->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *result;
  err = js_get_undefined(env, &result);
  assert(err == 0);

  err = js_resolve_deferred(env, req->deferred, result);
  assert(err == 0);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  free(req);
}

static void
paraql__on_before_finalize(uv_work_t *handle) {
  paraql_finalize_t *req = (paraql_finalize_t *) handle->data;

  paraql_statement_t *stmt = req->stmt;

  if (stmt->handle != NULL) {
    sqlite3_finalize(stmt->handle);
    stmt->handle = NULL;
  }

  paraql__remove_statement(stmt);
}

static js_value_t *
paraql_finalize(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_statement_t *stmt;
  err = js_get_value_external(env, argv[0], (void **) &stmt);
  assert(err == 0);

  paraql_finalize_t *req = malloc(sizeof(paraql_finalize_t));

  req->env = env;
  req->stmt = stmt;

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_finalize, paraql__on_after_finalize);
  assert(err == 0);

  return promise;
}

static void
paraql__on_after_reset(uv_work_t *handle, int status) {
  int err;

  paraql_reset_t *req = (paraql_reset_t *) handle->data;

  js_env_t *env = req->env;

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
paraql__on_before_reset(uv_work_t *handle) {
  paraql_reset_t *req = (paraql_reset_t *) handle->data;

  paraql_statement_t *stmt = req->stmt;

  if (stmt->handle != NULL) {
    sqlite3_reset(stmt->handle);
    sqlite3_clear_bindings(stmt->handle);
  } else {
    req->errcode = SQLITE_MISUSE;
    req->errmsg = STMT_FINALIZED;
  }
}

static js_value_t *
paraql_reset(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_statement_t *stmt;
  err = js_get_value_external(env, argv[0], (void **) &stmt);
  assert(err == 0);

  paraql_reset_t *req = malloc(sizeof(paraql_reset_t));

  req->errcode = 0;
  req->env = env;
  req->stmt = stmt;

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_reset, paraql__on_after_reset);
  assert(err == 0);

  return promise;
}

paraql_bind_value_t *
paraql__parse_value(js_env_t *env, js_value_t *value) {
  int err;

  paraql_bind_value_t *val = malloc(sizeof(paraql_bind_value_t));

  js_value_type_t type;
  err = js_typeof(env, value, &type);
  assert(err == 0);

  switch (type) {
  case js_null:
  case js_undefined:
    val->type = js_null;
    break;

  case js_number: {
    double n;
    err = js_get_value_double(env, value, &n);
    assert(err == 0);

    int64_t i = (int64_t) n;

    val->type = js_number;

    if (n == (double) i) {
      val->is_double = false;
      val->value.i = i;
    } else {
      val->is_double = true;
      val->value.d = n;
    }
    break;
  }

  case js_bigint: {
    int64_t n;
    bool lossless;
    err = js_get_value_bigint_int64(env, value, &n, &lossless);
    assert(err == 0);

    val->type = js_bigint;
    val->value.i = n;
  }

  case js_string: {
    size_t len;
    err = js_get_value_string_utf8(env, value, NULL, 0, &len);
    assert(err == 0);

    utf8_t *str = malloc(len + 1);

    err = js_get_value_string_utf8(env, value, str, len + 1, NULL);
    assert(err == 0);

    val->type = js_string;
    val->value.buffer.data = (void *) str;
    val->value.buffer.len = len;
    break;
  }

  case js_object: {
    bool is_typedarray;
    err = js_is_typedarray(env, value, &is_typedarray);
    assert(err == 0);

    if (is_typedarray) {
      void *data;
      size_t len;
      err = js_get_typedarray_info(env, value, NULL, &data, &len, NULL, NULL);
      assert(err == 0);

      val->type = js_object;
      val->value.buffer.data = data;
      val->value.buffer.len = len;
      break;
    }

    bool is_arraybuffer;
    err = js_is_arraybuffer(env, value, &is_arraybuffer);
    assert(err == 0);

    if (is_arraybuffer) {
      void *data;
      size_t len;
      err = js_get_arraybuffer_info(env, value, &data, &len);
      assert(err == 0);

      val->type = js_object;
      val->value.buffer.data = data;
      val->value.buffer.len = len;
      break;
    }

    return NULL;
  }

  default:
    return NULL;
  }

  return val;
}

static void
paraql__cancel_bind(js_env_t *env, js_handle_scope_t *scope, paraql_bind_t *req, int index, const char *errmsg) {
  int err;

  free(req->param_names);

  for (int i = 0; i < index; i++) {
    paraql_bind_value_t *value = req->values[i];

    if (value->type == js_string) {
      free(value->value.buffer.data);
    }

    free(value);
  }

  free(req->values);

  js_value_t *message;
  err = js_create_string_utf8(env, (utf8_t *) errmsg, -1, &message);
  assert(err == 0);

  js_value_t *error;
  err = js_create_type_error(env, NULL, message, &error);
  assert(err == 0);

  err = js_reject_deferred(env, req->deferred, error);
  assert(err == 0);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  free(req);
}

static void
paraql__free_bind_values(paraql_bind_t *req, int start) {
  for (int i = start; i < req->param_count; i++) {
    paraql_bind_value_t *value = req->values[i];

    if (value->type == js_string) {
      free(value->value.buffer.data);
    }

    free(value);
  }
}

static void
paraql__on_after_bind(uv_work_t *handle, int status) {
  int err;

  paraql_bind_t *req = (paraql_bind_t *) handle->data;

  js_env_t *env = req->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  err = js_delete_reference(env, req->named);
  assert(err == 0);

  err = js_delete_reference(env, req->positional);
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
paraql__on_before_bind(uv_work_t *handle) {
  int status;

  paraql_bind_t *req = (paraql_bind_t *) handle->data;

  paraql_statement_t *stmt = req->stmt;

  if (stmt->handle != NULL) {
    for (int i = 1; i <= req->param_count; i++) {
      paraql_bind_value_t *value = req->values[i - 1];

      switch (value->type) {
      case js_null:
      case js_undefined:
        status = sqlite3_bind_null(stmt->handle, i);
        break;

      case js_number:
        if (value->is_double) {
          status = sqlite3_bind_double(stmt->handle, i, value->value.d);
        } else {
          status = sqlite3_bind_int64(stmt->handle, i, value->value.i);
        }
        break;

      case js_bigint:
        status = sqlite3_bind_int64(stmt->handle, i, value->value.i);
        break;

      case js_string:
        status = sqlite3_bind_text(stmt->handle, i, (const char *) value->value.buffer.data, (int) value->value.buffer.len, SQLITE_TRANSIENT);
        free(value->value.buffer.data);
        break;

      case js_object:
        status = sqlite3_bind_blob(stmt->handle, i, value->value.buffer.data, (int) value->value.buffer.len, SQLITE_TRANSIENT);
        break;

      default:
        break;
      }

      free(value);

      if (status != SQLITE_OK) {
        req->errcode = status;
        req->errmsg = sqlite3_errmsg(stmt->db->handle);

        paraql__free_bind_values(req, i);

        free(req->values);

        return;
      }
    }
  } else {
    req->errcode = SQLITE_MISUSE;
    req->errmsg = STMT_FINALIZED;

    paraql__free_bind_values(req, 0);
  }

  free(req->values);
}

static void
paraql__on_after_parse(uv_work_t *handle, int status) {
  int err;

  paraql_bind_t *req = (paraql_bind_t *) handle->data;

  js_env_t *env = req->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  if (req->errcode) {
    err = js_delete_reference(env, req->named);
    assert(err == 0);

    err = js_delete_reference(env, req->positional);
    assert(err == 0);

    js_value_t *error;
    err = paraql__make_error(env, req->errcode, req->errmsg, &error);
    assert(err == 0);

    err = js_reject_deferred(env, req->deferred, error);
    assert(err == 0);

    free(req);
  } else {
    js_value_t *named;
    err = js_get_reference_value(env, req->named, &named);
    assert(err == 0);

    js_value_t *positional;
    err = js_get_reference_value(env, req->positional, &positional);
    assert(err == 0);

    uint32_t pos_len;
    err = js_get_array_length(env, positional, &pos_len);
    assert(err == 0);

    js_value_type_t named_type;
    err = js_typeof(env, named, &named_type);
    assert(err == 0);

    bool has_named = named_type == js_object;

    uint32_t pos_idx = 0;

    for (int i = 0; i < req->param_count; i++) {
      const char *name = req->param_names[i];

      if (name == NULL) {
        if (pos_idx >= pos_len) {
          return paraql__cancel_bind(env, scope, req, i, "Missing positional parameter");
        }

        js_value_t *value;
        err = js_get_element(env, positional, pos_idx++, &value);
        assert(err == 0);

        paraql_bind_value_t *val = paraql__parse_value(env, value);

        if (val == NULL) {
          return paraql__cancel_bind(env, scope, req, i, "Unsupported parameter type");
        }

        req->values[i] = val;

        continue;
      }

      if (!has_named) {
        return paraql__cancel_bind(env, scope, req, i, "Missing named parameters object");
      }

      bool found;
      err = js_has_named_property(env, named, name, &found);
      assert(err == 0);

      const char *key = name;

      if (!found) {
        err = js_has_named_property(env, named, name + 1, &found);
        assert(err == 0);

        if (found) key = name + 1;
      }

      if (!found) {
        return paraql__cancel_bind(env, scope, req, i, "Missing named parameter");
      }

      js_value_t *value;
      err = js_get_named_property(env, named, key, &value);
      assert(err == 0);

      paraql_bind_value_t *val = paraql__parse_value(env, value);

      if (val == NULL) {
        return paraql__cancel_bind(env, scope, req, i, "Unsupported parameter type");
      }

      req->values[i] = val;
    }

    if (pos_idx < pos_len) {
      return paraql__cancel_bind(env, scope, req, req->param_count, "Too many positional parameters");
    }

    if (has_named) {
      js_value_t *keys;
      err = js_get_property_names(env, named, &keys);
      assert(err == 0);

      uint32_t keys_len;
      err = js_get_array_length(env, keys, &keys_len);
      assert(err == 0);

      for (uint32_t k = 0; k < keys_len; k++) {
        js_value_t *key_value;
        err = js_get_element(env, keys, k, &key_value);
        assert(err == 0);

        utf8_t key[256];
        err = js_get_value_string_utf8(env, key_value, key, sizeof(key), NULL);
        assert(err == 0);

        bool known = false;

        for (int i = 0; i < req->param_count; i++) {
          const char *name = req->param_names[i];

          if (name == NULL) continue;

          if (strcmp(name, (const char *) key) == 0) {
            known = true;
            break;
          }

          if (strcmp(name + 1, (const char *) key) == 0) {
            known = true;
            break;
          }
        }

        if (!known) {
          return paraql__cancel_bind(env, scope, req, req->param_count, "Unknown named parameter");
        }
      }
    }

    free(req->param_names);

    uv_loop_t *loop;
    err = js_get_env_loop(env, &loop);
    assert(err == 0);

    err = uv_queue_work(loop, &req->handle, paraql__on_before_bind, paraql__on_after_bind);
    assert(err == 0);
  }

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
paraql__on_before_parse(uv_work_t *handle) {
  paraql_bind_t *req = (paraql_bind_t *) handle->data;

  paraql_statement_t *stmt = req->stmt;

  if (stmt->handle == NULL) {
    req->errcode = SQLITE_MISUSE;
    return;
  }

  if (stmt->handle != NULL) {
    sqlite3_reset(stmt->handle);
    sqlite3_clear_bindings(stmt->handle);

    req->param_count = sqlite3_bind_parameter_count(stmt->handle);
    req->param_names = malloc(sizeof(char *) * req->param_count);
    req->values = malloc(sizeof(paraql_bind_value_t *) * req->param_count);

    for (int i = 1; i <= req->param_count; i++) {
      req->param_names[i - 1] = sqlite3_bind_parameter_name(stmt->handle, i);
    }
  } else {
    req->errcode = SQLITE_MISUSE;
    req->errmsg = STMT_FINALIZED;
  }
}

static js_value_t *
paraql_bind(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 3;
  js_value_t *argv[3];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 3);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_statement_t *stmt;
  err = js_get_value_external(env, argv[0], (void **) &stmt);
  assert(err == 0);

  js_ref_t *named;
  err = js_create_reference(env, argv[1], 1, &named);
  assert(err == 0);

  js_ref_t *positional;
  err = js_create_reference(env, argv[2], 1, &positional);
  assert(err == 0);

  paraql_bind_t *req = malloc(sizeof(paraql_bind_t));

  req->errcode = 0;
  req->env = env;
  req->stmt = stmt;
  req->named = named;
  req->positional = positional;

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_parse, paraql__on_after_parse);
  assert(err == 0);

  return promise;
}

static void
paraql__on_after_step(uv_work_t *handle, int status) {
  int err;

  paraql_step_t *req = (paraql_step_t *) handle->data;

  js_env_t *env = req->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  if (req->errcode) {
    js_value_t *error;
    err = paraql__make_error(env, req->errcode, req->errmsg, &error);
    assert(err == 0);

    err = js_reject_deferred(env, req->deferred, error);
    assert(err == 0);
  } else if (req->done) {
    js_value_t *result;
    err = js_get_undefined(env, &result);
    assert(err == 0);

    err = js_resolve_deferred(env, req->deferred, result);
    assert(err == 0);
  } else {
    js_value_t *row;
    err = js_create_object(env, &row);
    assert(err == 0);

    for (int i = 0; i < req->count; i++) {
      paraql_step_value_t val = req->values[i];

      js_value_t *value;

      switch (val.type) {
      case SQLITE_INTEGER:
        err = js_create_int64(env, val.value.i, &value);
        assert(err == 0);
        break;

      case SQLITE_FLOAT:
        err = js_create_double(env, val.value.d, &value);
        assert(err == 0);
        break;

      case SQLITE_TEXT:
        err = js_create_string_utf8(env, (const utf8_t *) val.value.buffer.data, val.value.buffer.len, &value);
        assert(err == 0);
        break;

      case SQLITE_BLOB: {
        void *buf;
        err = js_create_arraybuffer(env, val.value.buffer.len, &buf, &value);
        assert(err == 0);

        if (val.value.buffer.len > 0) memcpy(buf, val.value.buffer.data, val.value.buffer.len);
        break;
      }

      case SQLITE_NULL:
      default:
        err = js_get_null(env, &value);
        assert(err == 0);
      }

      err = js_set_named_property(env, row, val.name, value);
      assert(err == 0);
    }

    err = js_resolve_deferred(env, req->deferred, row);
    assert(err == 0);

    free(req->values);
  }

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  free(req);
}

static void
paraql__on_before_step(uv_work_t *handle) {
  int status;

  paraql_step_t *req = (paraql_step_t *) handle->data;

  paraql_statement_t *stmt = req->stmt;

  if (stmt->handle != NULL) {
    status = sqlite3_step(stmt->handle);

    if (status == SQLITE_ROW) {
      int n = sqlite3_column_count(stmt->handle);

      req->done = false;
      req->count = n;
      req->values = malloc(sizeof(paraql_step_value_t) * n);

      for (int i = 0; i < n; i++) {
        req->values[i].name = sqlite3_column_name(stmt->handle, i);

        switch (sqlite3_column_type(stmt->handle, i)) {
        case SQLITE_INTEGER: {
          req->values[i].type = SQLITE_INTEGER;
          req->values[i].value.i = sqlite3_column_int64(stmt->handle, i);
          break;
        }

        case SQLITE_FLOAT: {
          req->values[i].type = SQLITE_FLOAT;
          req->values[i].value.d = sqlite3_column_double(stmt->handle, i);
          break;
        }

        case SQLITE_TEXT: {
          req->values[i].type = SQLITE_TEXT;
          req->values[i].value.buffer.data = (const void *) sqlite3_column_text(stmt->handle, i);
          req->values[i].value.buffer.len = sqlite3_column_bytes(stmt->handle, i);
          break;
        }

        case SQLITE_BLOB: {
          req->values[i].type = SQLITE_BLOB;
          req->values[i].value.buffer.data = sqlite3_column_blob(stmt->handle, i);
          req->values[i].value.buffer.len = sqlite3_column_bytes(stmt->handle, i);
          break;
        }

        case SQLITE_NULL:
        default:
          req->values[i].type = SQLITE_NULL;
        }
      }

      return;
    }

    if (status == SQLITE_DONE) {
      req->done = true;
      return;
    }

    req->errcode = status;
    req->errmsg = sqlite3_errmsg(stmt->db->handle);
  } else {
    req->errcode = SQLITE_MISUSE;
    req->errmsg = STMT_FINALIZED;
  }
}

static js_value_t *
paraql_step(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_statement_t *stmt;
  err = js_get_value_external(env, argv[0], (void **) &stmt);
  assert(err == 0);

  paraql_step_t *req = malloc(sizeof(paraql_step_t));

  req->errcode = 0;
  req->env = env;
  req->stmt = stmt;

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_step, paraql__on_after_step);
  assert(err == 0);

  return promise;
}

static void
paraql__on_after_run(uv_work_t *handle, int status) {
  int err;

  paraql_run_t *req = (paraql_run_t *) handle->data;

  js_env_t *env = req->env;

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
    err = js_create_object(env, &result);
    assert(err == 0);

    js_value_t *changes;
    err = js_create_int64(env, req->changes, &changes);
    assert(err == 0);

    err = js_set_named_property(env, result, "changes", changes);
    assert(err == 0);

    js_value_t *last_insert_rowid;
    err = js_create_int64(env, req->last_insert_rowid, &last_insert_rowid);
    assert(err == 0);

    err = js_set_named_property(env, result, "lastInsertRowid", last_insert_rowid);
    assert(err == 0);

    err = js_resolve_deferred(env, req->deferred, result);
    assert(err == 0);
  }

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  free(req);
}

static void
paraql__on_before_run(uv_work_t *handle) {
  int status;

  paraql_run_t *req = (paraql_run_t *) handle->data;

  paraql_statement_t *stmt = req->stmt;

  if (stmt->handle != NULL) {
    while ((status = sqlite3_step(stmt->handle)) == SQLITE_ROW) {
    }

    if (status != SQLITE_DONE) {
      req->errcode = status;
      req->errmsg = sqlite3_errmsg(stmt->db->handle);
      return;
    }

    req->changes = sqlite3_changes64(stmt->db->handle);
    req->last_insert_rowid = sqlite3_last_insert_rowid(stmt->db->handle);
  } else {
    req->errcode = SQLITE_MISUSE;
    req->errmsg = STMT_FINALIZED;
  }
}

static js_value_t *
paraql_run(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  paraql_statement_t *stmt;
  err = js_get_value_external(env, argv[0], (void **) &stmt);
  assert(err == 0);

  paraql_run_t *req = malloc(sizeof(paraql_run_t));

  req->errcode = 0;
  req->env = env;
  req->stmt = stmt;

  req->handle.data = (void *) req;

  js_value_t *promise;
  err = js_create_promise(env, &req->deferred, &promise);
  assert(err == 0);

  err = uv_queue_work(loop, &req->handle, paraql__on_before_run, paraql__on_after_run);
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
  V("prepare", paraql_prepare)
  V("finalize", paraql_finalize)
  V("reset", paraql_reset)
  V("bind", paraql_bind)
  V("step", paraql_step)
  V("run", paraql_run)
#undef V

  return exports;
}

BARE_MODULE(paraql, paraql_exports)
