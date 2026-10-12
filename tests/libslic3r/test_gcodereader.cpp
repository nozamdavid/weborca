#include <catch2/catch_test_macros.hpp>
#include <catch2/generators/catch_generators.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include <catch2/matchers/catch_matchers.hpp>
#include "libslic3r/Config.hpp"
#include "libslic3r/GCodeReader.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "test_utils.hpp"

#include <cstddef>
#include <fstream>

using namespace Slic3r;

TEST_CASE("Resetting a G-code processor clears pressure advance from the previous file", "[GCodeProcessor]")
{
    ScopedTemporaryFile file(".gcode");
    {
        std::ofstream output(file.string());
        output << "G90\nM83\nM900 K0.04\nG1 Z0.2 F600\nG1 X10 E1\n";
    }
    FullPrintConfig config;
    GCodeProcessor processor;
    processor.apply_config(config);
    processor.process_file(file.string());
    CHECK_THAT(processor.get_result().moves.back().pressure_advance, Catch::Matchers::WithinAbs(0.04, 1e-6));
    processor.reset();
    processor.apply_config(config);
    {
        std::ofstream output(file.string());
        output << "G90\nM83\nG1 Z0.2 F600\nG1 X10 E1\n";
    }
    processor.process_file(file.string());
    for (const auto& move : processor.get_result().moves)
        CHECK_THAT(move.pressure_advance, Catch::Matchers::WithinAbs(0.0, 0.0));
}

TEST_CASE("Omitting source line offsets preserves processed moves and estimates", "[GCodeProcessor]")
{
    ScopedTemporaryFile file(".gcode");
    {
        std::ofstream output(file.string());
        output << "G90\nM83\nG1 Z0.2 F600\nG1 X10 E1\nG1 Y10 E1\n";
        output << ';' << GCodeProcessor::reserved_tag(GCodeProcessor::ETags::Pause_Print) << '\n';
        output << "G1 Z0.4 F600\n";
        for (int i = 0; i < 512; ++i)
            output << "G1 X" << ((i % 2) ? 100 : 0) << " E1 F12000\n";
    }
    FullPrintConfig config;
    GCodeProcessor indexed;
    indexed.apply_config(config);
    indexed.process_file(file.string());
    GCodeProcessor unindexed;
    unindexed.apply_config(config);
    unindexed.result().lines_ends = { 77, 88 };
    unindexed.process_file(file.string(), nullptr, false);
    const auto& expected = indexed.get_result();
    const auto& actual = unindexed.get_result();
    REQUIRE_FALSE(expected.lines_ends.empty());
    CHECK(actual.lines_ends.empty());
    REQUIRE(actual.moves.size() == expected.moves.size());
    REQUIRE_FALSE(expected.custom_gcode_per_print_z.empty());
    REQUIRE(actual.custom_gcode_per_print_z.size() == expected.custom_gcode_per_print_z.size());
    CHECK_THAT(actual.custom_gcode_per_print_z.front().print_z,
               Catch::Matchers::WithinAbs(expected.custom_gcode_per_print_z.front().print_z, 0.0));
    for (size_t i = 0; i < actual.moves.size(); ++i) {
        CHECK(actual.moves[i].gcode_id == expected.moves[i].gcode_id);
        CHECK(actual.moves[i].type == expected.moves[i].type);
        for (size_t axis = 0; axis < 3; ++axis)
            CHECK_THAT(actual.moves[i].position[axis], Catch::Matchers::WithinAbs(expected.moves[i].position[axis], 0.0));
        CHECK_THAT(actual.moves[i].actual_feedrate, Catch::Matchers::WithinAbs(expected.moves[i].actual_feedrate, 0.0));
        for (size_t mode = 0; mode < actual.moves[i].time.size(); ++mode)
            CHECK_THAT(actual.moves[i].time[mode], Catch::Matchers::WithinAbs(expected.moves[i].time[mode], 0.0));
    }
    CHECK_THAT(unindexed.get_time(PrintEstimatedStatistics::ETimeMode::Normal),
               Catch::Matchers::WithinAbs(indexed.get_time(PrintEstimatedStatistics::ETimeMode::Normal), 0.0));
    CHECK(actual.print_statistics.total_volumes_per_extruder == expected.print_statistics.total_volumes_per_extruder);
    CHECK_THAT(actual.print_statistics.total_travel_distance, Catch::Matchers::WithinAbs(expected.print_statistics.total_travel_distance, 0.0));
}

namespace {

// The extrusion of the second of two moves that both give E1.
float second_move_extrusion(GCodeReader &reader)
{
    float extrusion = -1.f;
    reader.parse_buffer("G1 X1 E1\nG1 X2 E1\n", [&extrusion](GCodeReader &reader, const GCodeReader::GCodeLine &line) {
        extrusion = line.dist_E(reader);
    });
    return extrusion;
}

} // namespace

TEST_CASE("A G-code reader measures extrusion as relative or absolute as its config says", "[GCodeReader]")
{
    const bool  relative = GENERATE(false, true);
    const float expected = relative ? 1.f : 0.f;

    GCodeConfig config;
    config.use_relative_e_distances.value = relative;
    GCodeReader applied;
    applied.apply_config(config);
    CHECK(applied.config().use_relative_e_distances.value == relative);
    CHECK_THAT(second_move_extrusion(applied), Catch::Matchers::WithinAbs(expected, 1e-6));

    DynamicPrintConfig dynamic;
    dynamic.set_key_value("use_relative_e_distances", new ConfigOptionBool(relative));
    GCodeReader applied_dynamic;
    applied_dynamic.apply_config(dynamic);
    CHECK_THAT(second_move_extrusion(applied_dynamic), Catch::Matchers::WithinAbs(expected, 1e-6));

    GCodeReader copy = applied;
    CHECK(copy.config().use_relative_e_distances.value == relative);
    CHECK_THAT(second_move_extrusion(copy), Catch::Matchers::WithinAbs(expected, 1e-6));
}

TEST_CASE("A G-code reader without a config uses the default one", "[GCodeReader]")
{
    const bool  relative = GCodeConfig().use_relative_e_distances.value;
    GCodeReader reader;
    CHECK(reader.config().use_relative_e_distances.value == relative);
    CHECK_THAT(second_move_extrusion(reader), Catch::Matchers::WithinAbs(relative ? 1.f : 0.f, 1e-6));
}
