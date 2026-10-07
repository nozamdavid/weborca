/*
 * tbbmalloc crashes intermittently under Emscripten pthreads; mimalloc is already a scalable allocator.
 * This shim forwards all scalable_* allocator calls to the plain C allocator.
 */

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <malloc.h>

#if __has_include(<oneapi/tbb/scalable_allocator.h>)
#include <oneapi/tbb/scalable_allocator.h>
#endif

#ifndef TBBMALLOC_OK
#define TBBMALLOC_OK 0
#endif

void* scalable_malloc(size_t size) {
    return malloc(size);
}

void scalable_free(void* ptr) {
    free(ptr);
}

void* scalable_realloc(void* ptr, size_t size) {
    return realloc(ptr, size);
}

void* scalable_calloc(size_t nobj, size_t size) {
    return calloc(nobj, size);
}

int scalable_posix_memalign(void** memptr, size_t alignment, size_t size) {
    return posix_memalign(memptr, alignment, size);
}

void* scalable_aligned_malloc(size_t size, size_t alignment) {
    if (alignment < sizeof(void*)) {
        alignment = sizeof(void*);
    }
    void* ptr = NULL;
    if (posix_memalign(&ptr, alignment, size) != 0) {
        return NULL;
    }
    return ptr;
}

void* scalable_aligned_realloc(void* ptr, size_t size, size_t alignment) {
    if (!ptr) {
        return scalable_aligned_malloc(size, alignment);
    }
    if (size == 0) {
        scalable_aligned_free(ptr);
        return NULL;
    }
    void* new_ptr = scalable_aligned_malloc(size, alignment);
    if (!new_ptr) {
        return NULL;
    }
    size_t old_size = malloc_usable_size(ptr);
    size_t copy_size = (old_size < size) ? old_size : size;
    memcpy(new_ptr, ptr, copy_size);
    scalable_aligned_free(ptr);
    return new_ptr;
}

void scalable_aligned_free(void* ptr) {
    free(ptr);
}

size_t scalable_msize(void* ptr) {
    return ptr ? malloc_usable_size(ptr) : 0;
}

int scalable_allocation_mode(int param, intptr_t value) {
    (void)param;
    (void)value;
    return TBBMALLOC_OK;
}

int scalable_allocation_command(int cmd, void* param) {
    (void)cmd;
    (void)param;
    return TBBMALLOC_OK;
}
