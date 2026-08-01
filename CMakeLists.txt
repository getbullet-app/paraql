cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-napi REQUIRED PATHS node_modules/cmake-napi)
find_package(cmake-npm REQUIRED PATHS node_modules/cmake-npm)

project(paraql C)

fetch_package(
  "github:tursodatabase/libsql@libsql-0.9.30"
  SOURCE_DIR libsql_src
  BINARY_DIR libsql_bin
)

if(CMAKE_HOST_WIN32)
  find_program(
    make
    NAMES nmake
    REQUIRED
  )

  add_custom_command(
    OUTPUT ${libsql_bin}/sqlite3.c ${libsql_bin}/sqlite3.h
    COMMAND ${make} /f ${libsql_src}/libsql-sqlite3/makefile.msc sqlite3.c
    WORKING_DIRECTORY ${libsql_bin}
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
    OUTPUT ${libsql_bin}/Makefile
    COMMAND ${sh} ${libsql_src}/libsql-sqlite3/configure --enable-all
    WORKING_DIRECTORY ${libsql_bin}
    VERBATIM
  )
  
  add_custom_command(
    OUTPUT ${libsql_bin}/sqlite3.c ${libsql_bin}/sqlite3.h
    COMMAND ${make} sqlite3.c
    WORKING_DIRECTORY ${libsql_bin}
    DEPENDS ${libsql_bin}/Makefile
    VERBATIM
  )
endif()

add_library(libsql "${libsql_bin}/sqlite3.c")

target_include_directories(
  libsql
  INTERFACE "${libsql_bin}"
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
