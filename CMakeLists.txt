cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
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
