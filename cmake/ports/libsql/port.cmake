include_guard(GLOBAL)

if(WIN32)
  set(lib libsqlite3.lib)
else()
  set(lib libsqlite3.a)
endif()

declare_port(
  "github:tursodatabase/libsql@libsql-0.9.30"
  libsql
  AUTOTOOLS
  ENTRYPOINT <SOURCE_DIR>/libsql-sqlite3/configure
  BYPRODUCTS lib/${lib}
  PATCHES
    patches/01-pkg-config.patch
  ENV
    MACOSX_DEPLOYMENT_TARGET=13.0
)

add_library(libsql STATIC IMPORTED GLOBAL)

add_dependencies(libsql ${libsql})

set_target_properties(
  libsql
  PROPERTIES
  IMPORTED_LOCATION "${libsql_PREFIX}/lib/${lib}"
)

file(MAKE_DIRECTORY "${libsql_PREFIX}/include")

target_include_directories(
  libsql
  INTERFACE "${libsql_PREFIX}/include"
)
