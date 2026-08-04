cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-napi REQUIRED PATHS node_modules/cmake-napi)
find_package(cmake-npm REQUIRED PATHS node_modules/cmake-npm)

project(paraql C)

fetch_package(
  "github:tursodatabase/libsql@libsql-0.9.30"
  SOURCE_DIR libsql_src
  PATCHES "patches/libsql/makefile.patch"
)

set(sqlite3_src "${libsql_src}/libsql-sqlite3")
set(sqlite3_c "${sqlite3_src}/sqlite3.c")
set(sqlite3_h "${sqlite3_src}/sqlite3.h")

if(CMAKE_HOST_WIN32)
  find_program(
    make
    NAMES nmake
    REQUIRED
  )

  add_custom_command(
    OUTPUT ${sqlite3_c} ${sqlite3_h}
    COMMAND ${make} /f ${sqlite3_src}/makefile.msc sqlite3.c
    WORKING_DIRECTORY ${sqlite3_src}
    VERBATIM
  )
else()
  find_program(
    sh
    NAMES sh
    REQUIRED
  )
  
  find_program(
    make
    NAMES gmake make
    REQUIRED
  )
  
  add_custom_command(
    OUTPUT ${sqlite3_src}/Makefile
    COMMAND ${sh} ${sqlite3_src}/configure --enable-all
    WORKING_DIRECTORY ${sqlite3_src}
    VERBATIM
  )
  
  add_custom_command(
    OUTPUT ${sqlite3_c} ${sqlite3_h}
    COMMAND ${make} sqlite3.c
    WORKING_DIRECTORY ${sqlite3_src}
    DEPENDS ${sqlite3_src}/Makefile
    VERBATIM
  )
endif()

add_library(libsql "${sqlite3_c}")

target_include_directories(
  libsql
  INTERFACE "${sqlite3_src}"
)

add_bare_module(paraql_bare)

target_sources(
  ${paraql_bare}
  PRIVATE
    binding.c
)

target_link_libraries(
  ${paraql_bare}
  PRIVATE
    libsql
)

add_napi_module(paraql_node)

target_sources(
  ${paraql_node}
  PRIVATE
    binding.c
)

target_link_libraries(
  ${paraql_node}
  PUBLIC
    libsql
)

resolve_node_module(bare-compat-napi compat)

target_include_directories(
  ${paraql_node}
  PRIVATE
    "${compat}/include"
)
