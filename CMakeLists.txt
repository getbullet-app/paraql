cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)

project(paraql C)

fetch_package("https://sqlite.org/2026/sqlite-amalgamation-3530300.zip" SOURCE_DIR sqlite3)

add_library(sqlite3)

target_sources(
  sqlite3
  PRIVATE
    ${sqlite3}/sqlite3.c
)

target_include_directories(
  sqlite3
  INTERFACE
    ${sqlite3}
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
    sqlite3
)
