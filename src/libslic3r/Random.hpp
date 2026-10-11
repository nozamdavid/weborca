#pragma once

#include <algorithm>
#include <cstdint>
#include <limits>
#include <random>

namespace Slic3r::Random {

namespace detail {

// Compute both halves without compiler-specific 128-bit types or intrinsics.
inline void mul64wide(uint64_t u, uint64_t v, uint64_t &low, uint64_t &high)
{
    const uint64_t u1 = u >> 32;
    const uint64_t u0 = u & 0xFFFFFFFFULL;
    const uint64_t v1 = v >> 32;
    const uint64_t v0 = v & 0xFFFFFFFFULL;

    const uint64_t w0 = u0 * v0;
    const uint64_t t  = u1 * v0 + (w0 >> 32);
    uint64_t       w1 = t & 0xFFFFFFFFULL;
    const uint64_t w2 = t >> 32;
    w1 += u0 * v1;
    high = u1 * v1 + w2 + (w1 >> 32);
    low  = (w1 << 32) | (w0 & 0xFFFFFFFFULL);
}

} // namespace detail

// Inclusive uniform draw using the GNU libstdc++ Lemire mapping. Defining the
// mapping here keeps slicing independent of the platform's standard library.
// Even a singleton range consumes a draw; the full range returns it unchanged.
inline uint64_t uniform_bounded(std::mt19937_64 &rng, uint64_t upper_bound)
{
    if (upper_bound == std::numeric_limits<uint64_t>::max()) {
        return rng();
    }

    const uint64_t range = upper_bound + 1ULL;
    uint64_t low = 0;
    uint64_t high = 0;
    detail::mul64wide(rng(), range, low, high);
    if (low < range) {
        const uint64_t threshold = -range % range;
        while (low < threshold) {
            detail::mul64wide(rng(), range, low, high);
        }
    }
    return high;
}

// GNU forward pair shuffle preserves existing Linux mesh decimation ordering.
// Empty and singleton ranges consume no draws. Use individual swaps when a
// pair's joint range could exceed the generator's range.
template<typename RandomAccessIterator>
void shuffle(RandomAccessIterator first, RandomAccessIterator last, std::mt19937_64 &rng)
{
    const auto dist = last - first;
    if (dist <= 1) {
        return;
    }

    const uint64_t urange = static_cast<uint64_t>(dist);
    constexpr uint64_t urngrange = std::numeric_limits<uint64_t>::max();

    if (urngrange / urange >= urange) {
        auto i = first + 1;
        if ((urange % 2) == 0) {
            const uint64_t swap_idx = uniform_bounded(rng, 1);
            std::iter_swap(i++, first + swap_idx);
        }
        while (i != last) {
            const uint64_t b0 = static_cast<uint64_t>(i - first) + 1;
            const uint64_t b1 = b0 + 1;
            const uint64_t pair_range = b0 * b1;
            const uint64_t x = uniform_bounded(rng, pair_range - 1);
            std::iter_swap(i++, first + (x / b1));
            std::iter_swap(i++, first + (x % b1));
        }
        return;
    }

    for (auto i = first + 1; i != last; ++i) {
        const uint64_t bound = static_cast<uint64_t>(i - first);
        std::iter_swap(i, first + uniform_bounded(rng, bound));
    }
}

} // namespace Slic3r::Random
