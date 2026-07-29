cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
find_package(cmake-napi REQUIRED PATHS node_modules/cmake-napi)
find_package(cmake-npm REQUIRED PATHS node_modules/cmake-npm)
find_package(cmake-ports REQUIRED PATHS node_modules/cmake-ports)

project(paraql C)

find_port(libsql)

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
