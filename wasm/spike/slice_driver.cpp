#include "libslic3r/libslic3r.h"
#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Config.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/ModelArrange.hpp"
#include "libslic3r/Point.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Thread.hpp"
#include "libslic3r/Utils.hpp"

#if __has_include(<tbb/task_arena.h>)
#include <tbb/task_arena.h>
#define HAS_TBB 1
#endif

#include <chrono>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

using namespace Slic3r;

int main(int argc, char* argv[])
{
    save_main_thread_id();

    std::string input_stl;
    std::string output_gcode;
    std::string config_json;
    std::string resources_dir_path;
    int num_threads = 0;

    std::vector<std::string> positional;
    for (int i = 1; i < argc; ++i) {
        std::string_view arg = argv[i];
        if (arg == "--config" || arg == "-c") {
            if (i + 1 < argc) config_json = argv[++i];
        } else if (arg == "--threads" || arg == "-t") {
            if (i + 1 < argc) num_threads = std::stoi(argv[++i]);
        } else if (arg == "--resources-dir" || arg == "-r") {
            if (i + 1 < argc) resources_dir_path = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: orca_slice_driver <input.stl> <output.gcode> [config.json] [threads]\n";
            return 0;
        } else if (arg.rfind("-", 0) == 0) {
            std::cerr << "Unknown option: " << arg << "\n";
            return 1;
        } else {
            positional.push_back(argv[i]);
        }
    }

    if (positional.size() >= 1) input_stl = positional[0];
    if (positional.size() >= 2) output_gcode = positional[1];
    if (positional.size() >= 3) {
        try {
            size_t idx = 0;
            int t = std::stoi(positional[2], &idx);
            if (idx == positional[2].size() && config_json.empty() && positional.size() == 3) {
                num_threads = t;
            } else {
                config_json = positional[2];
            }
        } catch (...) {
            config_json = positional[2];
        }
    }
    if (positional.size() >= 4) {
        num_threads = std::stoi(positional[3]);
    }

    if (input_stl.empty() || output_gcode.empty()) {
        std::cerr << "Usage: orca_slice_driver <input.stl> <output.gcode> [config.json] [threads]\n";
        return 1;
    }

    // Set resources directory
    if (resources_dir_path.empty()) {
        if (std::filesystem::exists("resources")) {
            resources_dir_path = std::filesystem::absolute("resources").string();
        } else if (std::filesystem::exists("../resources")) {
            resources_dir_path = std::filesystem::absolute("../resources").string();
        } else if (std::filesystem::exists("../../resources")) {
            resources_dir_path = std::filesystem::absolute("../../resources").string();
        }
    }
    if (!resources_dir_path.empty()) {
        set_resources_dir(resources_dir_path);
        set_var_dir((std::filesystem::path(resources_dir_path) / "images").string());
        set_sys_shapes_dir((std::filesystem::path(resources_dir_path) / "shapes").string());
        set_custom_gcodes_dir((std::filesystem::path(resources_dir_path) / "custom_gcodes").string());
    }

    auto run_pipeline = [&]() -> int {
        try {
            auto t_start = std::chrono::steady_clock::now();

            // Step 2: Load STL into Model
            auto t0 = std::chrono::steady_clock::now();
            Model model = Model::read_from_file(input_stl);
            if (model.objects.empty())
                throw RuntimeError("No objects loaded from file: " + input_stl);
            auto t_load_stl = std::chrono::steady_clock::now();

            // Step 3: Base config from defaults, apply JSON config if given, validate
            DynamicPrintConfig config = DynamicPrintConfig::full_print_config();
            if (!config_json.empty()) {
                DynamicPrintConfig loaded_config;
                std::map<std::string, std::string> key_values;
                std::string reason;
                loaded_config.load_from_json(config_json, ForwardCompatibilitySubstitutionRule::EnableSilent, key_values, reason);
                if (!reason.empty())
                    throw RuntimeError("Failed to load JSON config (" + config_json + "): " + reason);
                loaded_config.normalize_fdm();
                config.apply(loaded_config);
            }
            if (config.opt_string("before_layer_change_gcode").empty() && config.opt_string("layer_change_gcode").empty()) {
                config.set_key_value("before_layer_change_gcode", new ConfigOptionString("G92 E0"));
            }
            config.normalize_fdm();
            if (auto errors = config.validate(true); !errors.empty()) {
                std::string msg = "Config validation failed:\n";
                for (const auto &[k, v] : errors)
                    msg += "  " + k + ": " + v + "\n";
                throw RuntimeError(msg);
            }
            auto t_config = std::chrono::steady_clock::now();

            // Step 4: Center object on bed and arrange
            BoundingBoxf bed_bbox;
            if (const auto *bed_shape_opt = config.opt<ConfigOptionPoints>("printable_area");
                bed_shape_opt && !bed_shape_opt->values.empty()) {
                for (const auto &p : bed_shape_opt->values)
                    bed_bbox.merge(p);
            }
            Vec2d bed_center = bed_bbox.defined ? bed_bbox.center() : Vec2d(100.0, 100.0);
            model.center_instances_around_point(bed_center);
            arrange_objects(model, InfiniteBed{Point::new_scale(bed_center.x(), bed_center.y())},
                            ArrangeParams{scaled(min_object_distance(config))});

            Print print;
            for (ModelObject *mo : model.objects) {
                mo->ensure_on_bed();
                print.auto_assign_extruders(mo);
            }
            auto t_arrange = std::chrono::steady_clock::now();

            // Step 5: Apply model & config, validate, process, export G-code
            print.apply(model, config);
            // Mirror native CLI: true when printer_model starts with "Bambu Lab"
            print.is_BBL_printer() = (config.opt_string("printer_model").compare(0, 9, "Bambu Lab") == 0);
            if (auto err = print.validate(); !err.string.empty())
                throw RuntimeError("Print validation failed: " + err.string);
            auto t_apply = std::chrono::steady_clock::now();

            print.set_status_silent();
            print.process();
            auto t_process = std::chrono::steady_clock::now();

            std::string final_gcode = print.export_gcode(output_gcode, nullptr, nullptr);
            auto t_export = std::chrono::steady_clock::now();

            // Step 6: Print timings, layer count, and G-code size
            std::string final_path = final_gcode.empty() ? output_gcode : final_gcode;
            uintmax_t gcode_size = std::filesystem::file_size(final_path);

            size_t layer_count = 0;
            for (const auto *obj : print.objects())
                layer_count = std::max(layer_count, obj->total_layer_count());

            auto ms = [](auto d) { return std::chrono::duration_cast<std::chrono::milliseconds>(d).count(); };
            std::cout << "Timing:\n"
                      << "  Load STL:       " << ms(t_load_stl - t0) << " ms\n"
                      << "  Config setup:   " << ms(t_config - t_load_stl) << " ms\n"
                      << "  Arrange/center: " << ms(t_arrange - t_config) << " ms\n"
                      << "  Print apply:    " << ms(t_apply - t_arrange) << " ms\n"
                      << "  Slicing:        " << ms(t_process - t_apply) << " ms\n"
                      << "  Export G-code:  " << ms(t_export - t_process) << " ms\n"
                      << "  Total:          " << ms(t_export - t_start) << " ms\n";
            std::cout << "Layer count: " << layer_count << "\n";
            std::cout << "G-code size: " << gcode_size << " bytes (" << final_path << ")\n";

            return 0;
        } catch (const std::exception &e) {
            std::cerr << "Error: " << e.what() << "\n";
            return 1;
        } catch (...) {
            std::cerr << "Error: Unknown exception occurred.\n";
            return 1;
        }
    };

#if HAS_TBB
    // Not tbb::global_control: it caps the real thread count but leaves this_task_arena::max_concurrency()
    // at the core count, and name_tbb_thread_pool_threads_set_locale() (Thread.cpp) then waits forever
    // for that many tasks to run at once.
    if (num_threads > 0) {
        tbb::task_arena arena(num_threads);
        return arena.execute(run_pipeline);
    }
#endif

    return run_pipeline();
}
