#include "libslic3r/Model.hpp"
#include "libslic3r/ModelArrange.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/Thread.hpp"
#include "libslic3r/Utils.hpp"
#include <tbb/task_arena.h>
#include <iostream>
#include <boost/property_tree/ini_parser.hpp>

// getConfig returns opt_serialize values: INI load deserializes them losslessly.
int main(int argc, char **argv)
{
    if (argc != 5) return 2;
    Slic3r::save_main_thread_id();
    Slic3r::set_resources_dir(argv[4]);
    tbb::task_arena arena(4);
    return arena.execute([&] {
        try {
            using namespace Slic3r;
            auto config = DynamicPrintConfig::full_print_config();
            boost::property_tree::ptree serialized;
            boost::property_tree::read_ini(argv[3], serialized);
            config.load(serialized, ForwardCompatibilitySubstitutionRule::Disable);
            config.normalize_fdm();
            auto model = Model::read_from_file(argv[1], nullptr, nullptr,
                LoadStrategy::AddDefaultInstances | LoadStrategy::LoadModel);
            model.remove_backup_path_if_exist();
            BoundingBoxf bed;
            for (const auto &p : config.opt<ConfigOptionPoints>("printable_area")->values) bed.merge(p);
            auto center = bed.center();
            model.center_instances_around_point(center);
            arrange_objects(model, InfiniteBed{Point::new_scale(center.x(), center.y())},
                ArrangeParams{scaled(min_object_distance(config))});
            Print print;
            for (auto *object : model.objects) {
                object->ensure_on_bed();
                print.auto_assign_extruders(object);
            }
            print.apply(model, config);
            print.is_BBL_printer() = false;
            if (auto error = print.validate(); !error.string.empty()) throw RuntimeError(error.string);
            print.set_status_silent();
            print.process();
            print.export_gcode(argv[2], nullptr, nullptr);
            return 0;
        } catch (const std::exception &error) {
            std::cerr << error.what() << '\n';
            return 1;
        }
    });
}
