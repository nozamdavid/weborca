#include <catch2/catch_test_macros.hpp>
#include "libslic3r/Random.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <numeric>
#include <random>
#include <vector>

TEST_CASE("Bounded draws preserve the GNU random mapping", "[Random]")
{
    // Fixed GNU libstdc++ fixtures also run on libc++ and MSVC, whose standard
    // distributions use different mappings. The rejection cases exercise carries.
    struct Fixture { uint64_t bound; std::array<uint64_t, 5> values; };
    const Fixture fixtures[] = {
        {0, {0, 0, 0, 0, 0}},
        {1, {1, 0, 1, 1, 0}},
        {2, {2, 0, 2, 2, 0}},
        {10, {8, 2, 7, 10, 0}},
        {0xFFFFFFFFULL, {3379370268ULL, 1075804871ULL, 3052309686ULL, 4065907245ULL, 82768564ULL}},
        {0x100000000ULL, {3379370269ULL, 1075804871ULL, 3052309687ULL, 4065907246ULL, 82768564ULL}},
        {0x7FFFFFFFFFFFFFFFULL, {7257142393139058515ULL, 2310273370083821454ULL, 6554785140758948860ULL, 8731469323574217161ULL, 177744139283869798ULL}},
        {0x8000000000000000ULL, {7257142393139058515ULL, 6554785140758948860ULL, 8731469323574217161ULL, 2317997734240821264ULL, 4802085494626258278ULL}},
        {0xFFFFFFFFFFFFFFFEULL, {14514284786278117029ULL, 4620546740167642907ULL, 13109570281517897719ULL, 17462938647148434321ULL, 355488278567739595ULL}},
        {0xFFFFFFFFFFFFFFFFULL, {14514284786278117030ULL, 4620546740167642908ULL, 13109570281517897720ULL, 17462938647148434322ULL, 355488278567739596ULL}},
        {3, {3, 1, 2, 3, 0}},
        {5, {4, 1, 4, 5, 0}},
        {7, {6, 2, 5, 7, 0}},
        {0xAAAAAAAAAAAAAAAAULL, {9676189857518744686ULL, 8739713521011931813ULL, 11641959098098956214ULL, 236992185711826397ULL, 4979417493546617998ULL}},
        {0xFFFFFFFFFFFFFFFFULL / 3, {4838094928759372343ULL, 5820979549049478107ULL, 118496092855913198ULL, 2489708746773308999ULL, 1545331822827214176ULL}}
    };
    for (const auto &fixture : fixtures) {
        CAPTURE(fixture.bound);
        std::mt19937_64 rng(5489ULL);
        for (uint64_t expected : fixture.values) {
            const uint64_t value = Slic3r::Random::uniform_bounded(rng, fixture.bound);
            CHECK(value == expected);
            CHECK(value <= fixture.bound);
        }
        if (fixture.bound == 0 || fixture.bound == 0xFFFFFFFFFFFFFFFFULL)
            CHECK(rng() == 7469126240319926998ULL);
    }
}

TEST_CASE("Small shuffles preserve permutations and consumed draws", "[Random]")
{
    struct Fixture { std::vector<int> values; uint64_t next_draw; };
    const Fixture fixtures[] = {
        {{}, 14514284786278117030ULL},
        {{0}, 14514284786278117030ULL},
        {{0, 1}, 4620546740167642908ULL},
        {{0, 2, 1}, 4620546740167642908ULL},
        {{2, 1, 0, 3}, 13109570281517897720ULL},
        {{4, 3, 1, 2, 0}, 13109570281517897720ULL},
        {{2, 1, 0, 5, 3, 4}, 17462938647148434322ULL},
        {{4, 6, 1, 2, 5, 0, 3}, 17462938647148434322ULL}
    };
    for (const auto &fixture : fixtures) {
        CAPTURE(fixture.values.size());
        std::vector<int> values(fixture.values.size());
        std::iota(values.begin(), values.end(), 0);
        std::mt19937_64 rng(5489ULL);
        Slic3r::Random::shuffle(values.begin(), values.end(), rng);
        CHECK(values == fixture.values);
        CHECK(rng() == fixture.next_draw);
    }
}

TEST_CASE("Shuffle reproduces canonical GNU permutation for large vertex/face count", "[Random]")
{
    // Benchmarked against decimation mesh test case with N=225706 faces and seed 27644437ULL.
    constexpr size_t N = 225706;
    constexpr uint64_t SEED = 27644437ULL;

    std::vector<size_t> vec(N);
    for (size_t i = 0; i < N; ++i) {
        vec[i] = i;
    }

    std::mt19937_64 rng(SEED);
    Slic3r::Random::shuffle(vec.begin(), vec.end(), rng);

    // Verify first 8 elements match canonical GNU libstdc++ pair shuffle
    REQUIRE(vec.size() == N);
    CHECK(vec[0] == 7437);
    CHECK(vec[1] == 222776);
    CHECK(vec[2] == 61757);
    CHECK(vec[3] == 41297);
    CHECK(vec[4] == 214559);
    CHECK(vec[5] == 88775);
    CHECK(vec[6] == 165555);
    CHECK(vec[7] == 158585);

    // Verify full permutation 64-bit FNV-1a hash
    uint64_t fnv_hash = 14695981039346656037ULL;
    for (size_t val : vec) {
        fnv_hash ^= static_cast<uint64_t>(val);
        fnv_hash *= 1099511628211ULL;
    }
    CHECK(fnv_hash == 0xa9d0c99717920382ULL);

    // Verify subsequent RNG state draws match GNU libstdc++ exactly
    CHECK(rng() == 1287969542156651440ULL);
    CHECK(rng() == 2354039146796375683ULL);
    CHECK(rng() == 8738553430063799633ULL);
    CHECK(rng() == 14983120753460950484ULL);
    CHECK(rng() == 6697380849602004289ULL);
}
