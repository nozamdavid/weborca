#include "PlateOps.hpp"

#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/GCode/WipeTower.hpp"
#include "libslic3r/GCode/WipeTowerEstimate.hpp"
#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/Exception.hpp"

#include <cmath>
#include <algorithm>
#include <limits>
#include <set>
#include <map>

namespace OrcaEngine {

static constexpr double LOGICAL_PART_PLATE_GAP = 1.0 / 5.0; // 0.2

int computeColumnCount(size_t count) {
    if (count <= 0) return 1;
    float value = std::sqrt(static_cast<float>(count));
    float round_value = std::round(value);
    int cols;
    if (value > round_value)
        cols = static_cast<int>(round_value) + 1;
    else
        cols = static_cast<int>(round_value);
    return std::max(1, cols);
}

void getPlateStride(double bed_width, double bed_depth, double& stride_x, double& stride_y) {
    stride_x = bed_width * (1.0 + LOGICAL_PART_PLATE_GAP);
    stride_y = bed_depth * (1.0 + LOGICAL_PART_PLATE_GAP);
}

void getBedDimensions(const Slic3r::DynamicPrintConfig& config, double& width, double& depth, double& height) {
    Slic3r::BoundingBoxf bed_bbox;
    if (const auto* bed_shape_opt = config.opt<Slic3r::ConfigOptionPoints>("printable_area");
        bed_shape_opt && !bed_shape_opt->values.empty()) {
        for (const auto& p : bed_shape_opt->values)
            bed_bbox.merge(p);
    }
    width = bed_bbox.defined ? bed_bbox.size().x() : 256.0;
    depth = bed_bbox.defined ? bed_bbox.size().y() : 256.0;
    height = config.has("printable_height") ? config.opt_float("printable_height") : 256.0;
}

Slic3r::Vec3d computePlateOrigin(int index, size_t total_plates, double bed_width, double bed_depth) {
    int cols = computeColumnCount(total_plates);
    double stride_x, stride_y;
    getPlateStride(bed_width, bed_depth, stride_x, stride_y);
    int row = index / cols;
    int col = index % cols;
    return Slic3r::Vec3d(col * stride_x, -row * stride_y, 0.0);
}

void assignInstancesToPlates(
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config
) {
    if (plates.empty()) return;

    double bed_width, bed_depth, bed_height;
    getBedDimensions(config, bed_width, bed_depth, bed_height);

    for (auto* p : plates) {
        p->objects_and_instances.clear();
    }

    std::vector<Slic3r::BoundingBoxf3> plate_boxes;
    plate_boxes.reserve(plates.size());
    for (size_t k = 0; k < plates.size(); ++k) {
        Slic3r::Vec3d origin = computePlateOrigin(static_cast<int>(k), plates.size(), bed_width, bed_depth);
        plate_boxes.emplace_back(origin, origin + Slic3r::Vec3d(bed_width, bed_depth, bed_height));
    }

    for (size_t oi = 0; oi < model.objects.size(); ++oi) {
        const auto* obj = model.objects[oi];
        for (size_t ii = 0; ii < obj->instances.size(); ++ii) {
            Slic3r::BoundingBoxf3 inst_bbox = obj->instance_convex_hull_bounding_box(ii);
            int assigned_plate = -1;
            for (size_t k = 0; k < plates.size(); ++k) {
                if (plate_boxes[k].intersects(inst_bbox)) {
                    assigned_plate = static_cast<int>(k);
                    break;
                }
            }
            if (assigned_plate < 0) {
                Slic3r::Vec3d c = inst_bbox.center();
                double min_dist_sq = std::numeric_limits<double>::max();
                for (size_t k = 0; k < plates.size(); ++k) {
                    Slic3r::Vec3d pc = plate_boxes[k].center();
                    double d2 = (c.x() - pc.x()) * (c.x() - pc.x()) + (c.y() - pc.y()) * (c.y() - pc.y());
                    if (d2 < min_dist_sq) {
                        min_dist_sq = d2;
                        assigned_plate = static_cast<int>(k);
                    }
                }
            }
            if (assigned_plate >= 0 && assigned_plate < static_cast<int>(plates.size())) {
                plates[assigned_plate]->objects_and_instances.emplace_back(static_cast<int>(oi), static_cast<int>(ii));
            }
        }
    }
}

void updateWipeTowerPosition(
    Slic3r::DynamicPrintConfig& config,
    Slic3r::Model& model,
    const Slic3r::PlateDataPtrs& plates,
    int plate_idx
) {
    auto* wt_x_opt = config.opt<Slic3r::ConfigOptionFloats>("wipe_tower_x");
    auto* wt_y_opt = config.opt<Slic3r::ConfigOptionFloats>("wipe_tower_y");

    if (!wt_x_opt) {
        config.set_key_value("wipe_tower_x", new Slic3r::ConfigOptionFloats{ 165.0 });
        wt_x_opt = config.opt<Slic3r::ConfigOptionFloats>("wipe_tower_x");
    }
    if (!wt_y_opt) {
        config.set_key_value("wipe_tower_y", new Slic3r::ConfigOptionFloats{ 250.0 });
        wt_y_opt = config.opt<Slic3r::ConfigOptionFloats>("wipe_tower_y");
    }

    size_t num_plates = std::max<size_t>(1, plates.size());
    if (wt_x_opt->values.size() < num_plates) {
        double default_x = wt_x_opt->values.empty() ? 165.0 : wt_x_opt->values.front();
        wt_x_opt->values.resize(num_plates, default_x);
    }
    if (wt_y_opt->values.size() < num_plates) {
        double default_y = wt_y_opt->values.empty() ? 250.0 : wt_y_opt->values.front();
        wt_y_opt->values.resize(num_plates, default_y);
    }
    if (model.wipe_tower.positions.size() < num_plates) {
        model.wipe_tower.positions.resize(num_plates, Slic3r::Vec2d(wt_x_opt->values.front(), wt_y_opt->values.front()));
    }

    size_t start_idx = (plate_idx >= 0 && plate_idx < static_cast<int>(num_plates)) ? plate_idx : 0;
    size_t end_idx = (plate_idx >= 0 && plate_idx < static_cast<int>(num_plates)) ? (plate_idx + 1) : num_plates;

    double bed_width, bed_depth, bed_height;
    getBedDimensions(config, bed_width, bed_depth, bed_height);

    Slic3r::BoundingBoxf bed_bbox;
    if (const auto* bed_shape_opt = config.opt<Slic3r::ConfigOptionPoints>("printable_area");
        bed_shape_opt && !bed_shape_opt->values.empty()) {
        for (const auto& p : bed_shape_opt->values)
            bed_bbox.merge(p);
    }
    double x_min = bed_bbox.defined ? bed_bbox.min.x() : 0.0;
    double x_max = bed_bbox.defined ? bed_bbox.max.x() : bed_width;
    double y_max = bed_bbox.defined ? bed_bbox.max.y() : bed_depth;

    auto printer_structure_opt = config.option<Slic3r::ConfigOptionEnum<Slic3r::PrinterStructure>>("printer_structure");
    float default_x = 165.0f;
    float default_y = 250.0f;
    if (printer_structure_opt && printer_structure_opt->value == Slic3r::PrinterStructure::psI3) {
        default_x = 0.0f;
        default_y = 250.0f;
    }
    std::string printer_type = config.opt_string("printer_model");
    if (printer_type == "N9") {
        default_y = 160.0f;
    }

    std::vector<unsigned int> filament_ids;
    int num_extruders = 1;
    if (const auto* nozzle_opt = config.opt<Slic3r::ConfigOptionFloats>("nozzle_diameter")) {
        num_extruders = nozzle_opt->values.size();
    }
    for (int i = 0; i < std::max(2, num_extruders); ++i) {
        filament_ids.push_back(static_cast<unsigned int>(i));
    }
    double layer_height = config.has("layer_height") ? config.opt_float("layer_height") : 0.2;
    double max_height = 20.0;
    for (const auto* obj : model.objects) {
        max_height = std::max(max_height, obj->bounding_box_exact().size().z());
    }

    Slic3r::WipeTowerType wt_type = Slic3r::resolve_wipe_tower_type(config);
    Slic3r::WipeTowerFootprint footprint = Slic3r::estimate_wipe_tower_footprint(config, wt_type, filament_ids, layer_height, max_height);
    if (Slic3r::is_approx(footprint.width, 0.0) || Slic3r::is_approx(footprint.depth, 0.0)) {
        footprint = Slic3r::estimate_wipe_tower_footprint(config, wt_type, {0, 1}, layer_height, max_height);
    }
    Slic3r::Vec3d wt_size(footprint.width, footprint.depth, footprint.height);
    const float brim_width = static_cast<float>(footprint.brim_width);
    const float margin = static_cast<float>(WIPE_TOWER_AUTO_MARGIN) + brim_width;

    Slic3r::Points bed_points = Slic3r::get_bed_shape(config);
    if (bed_points.empty() && bed_bbox.defined) {
        if (const auto* bed_shape_opt = config.opt<Slic3r::ConfigOptionPoints>("printable_area")) {
            for (const auto& p : bed_shape_opt->values)
                bed_points.emplace_back(Slic3r::Point::new_scale(p.x(), p.y()));
        }
    }

    for (size_t i = start_idx; i < end_idx; ++i) {
        float x = (i < wt_x_opt->values.size()) ? static_cast<float>(wt_x_opt->values[i]) : default_x;
        float y = (i < wt_y_opt->values.size()) ? static_cast<float>(wt_y_opt->values[i]) : default_y;

        if (x + margin + wt_size(0) > x_max) {
            x = x_max - wt_size(0) - margin;
        } else if (x < margin + x_min) {
            x = margin + x_min;
        }

        if (y + margin + wt_size(1) > y_max) {
            y = y_max - wt_size(1) - margin;
        } else if (y < margin) {
            y = margin;
        }

        if (bed_points.size() >= 3) {
            Slic3r::Polygons bed{Slic3r::Polygon(bed_points)};
            const Slic3r::BoundingBox tower(
                Slic3r::Point::new_scale(x, y),
                Slic3r::Point::new_scale(x + wt_size(0), y + wt_size(1))
            );
            const Slic3r::Vec2f move = Slic3r::WipeTower::move_box_inside_polygon(
                tower, bed, Slic3r::scaled(margin)
            );
            x += move.x();
            y += move.y();
        }

        wt_x_opt->values[i] = x;
        wt_y_opt->values[i] = y;
        model.wipe_tower.positions[i] = Slic3r::Vec2d(x, y);
    }
}

nlohmann::json listPlates(
    const Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    const Slic3r::DynamicPrintConfig& config
) {
    if (plates.empty()) {
        auto* p = new Slic3r::PlateData();
        p->plate_index = 0;
        p->plate_name = "Plate 1";
        plates.push_back(p);
    }

    assignInstancesToPlates(const_cast<Slic3r::Model&>(model), plates, config);

    double bed_width, bed_depth, bed_height;
    getBedDimensions(config, bed_width, bed_depth, bed_height);

    nlohmann::json res = nlohmann::json::array();
    for (size_t k = 0; k < plates.size(); ++k) {
        const auto* p = plates[k];
        Slic3r::Vec3d origin = computePlateOrigin(static_cast<int>(k), plates.size(), bed_width, bed_depth);

        nlohmann::json p_json = nlohmann::json::object();
        p_json["index"] = static_cast<int>(k);
        p_json["name"] = p->plate_name.empty() ? ("Plate " + std::to_string(k + 1)) : p->plate_name;
        p_json["locked"] = p->locked;
        p_json["origin"] = {origin.x(), origin.y(), origin.z()};
        p_json["size"] = {bed_width, bed_depth, bed_height};

        nlohmann::json inst_pairs = nlohmann::json::array();
        for (const auto& pair : p->objects_and_instances) {
            if (pair.first >= 0 && static_cast<size_t>(pair.first) < model.objects.size()) {
                const auto* o = model.objects[pair.first];
                if (pair.second >= 0 && static_cast<size_t>(pair.second) < o->instances.size()) {
                    const auto* i = o->instances[pair.second];
                    inst_pairs.push_back({
                        {"objectId", o->id().id},
                        {"instanceId", i->id().id},
                        {"objectIndex", pair.first},
                        {"instanceIndex", pair.second}
                    });
                }
            }
        }
        p_json["instances"] = inst_pairs;

        nlohmann::json cfg_json = nlohmann::json::object();
        for (const std::string& key : p->config.keys()) {
            cfg_json[key] = p->config.opt_serialize(key);
        }
        p_json["config"] = cfg_json;
        p_json["filamentMaps"] = p->filament_maps;

        res.push_back(p_json);
    }
    return res;
}

nlohmann::json addPlate(
    const nlohmann::json& args,
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    Slic3r::DynamicPrintConfig& config
) {
    if (plates.empty()) {
        auto* p0 = new Slic3r::PlateData();
        p0->plate_index = 0;
        p0->plate_name = "Plate 1";
        plates.push_back(p0);
    }

    double bed_width, bed_depth, bed_height;
    getBedDimensions(config, bed_width, bed_depth, bed_height);

    size_t old_count = plates.size();
    size_t new_count = old_count + 1;
    int old_cols = computeColumnCount(old_count);
    int new_cols = computeColumnCount(new_count);

    if (old_cols != new_cols) {
        assignInstancesToPlates(model, plates, config);
        for (size_t i = 0; i < old_count; ++i) {
            Slic3r::Vec3d old_origin = computePlateOrigin(static_cast<int>(i), old_count, bed_width, bed_depth);
            Slic3r::Vec3d new_origin = computePlateOrigin(static_cast<int>(i), new_count, bed_width, bed_depth);
            Slic3r::Vec3d shift = new_origin - old_origin;
            if (!Slic3r::is_approx(shift.norm(), 0.0)) {
                for (const auto& pair : plates[i]->objects_and_instances) {
                    if (pair.first >= 0 && static_cast<size_t>(pair.first) < model.objects.size()) {
                        auto* o = model.objects[pair.first];
                        if (pair.second >= 0 && static_cast<size_t>(pair.second) < o->instances.size()) {
                            auto* inst = o->instances[pair.second];
                            inst->set_offset(inst->get_offset() + shift);
                        }
                    }
                }
            }
        }
    }

    auto* new_plate = new Slic3r::PlateData();
    new_plate->plate_index = static_cast<int>(old_count);
    std::string name = args.value("name", "Plate " + std::to_string(new_count));
    new_plate->plate_name = name;
    new_plate->locked = false;
    if (args.contains("config") && args["config"].is_object()) {
        for (const auto& [k, v] : args["config"].items()) {
            std::string sval = v.is_string() ? v.get<std::string>() : v.dump();
            try {
                new_plate->config.set_deserialize_strict(k, sval);
            } catch (...) {}
        }
    }
    plates.push_back(new_plate);

    updateWipeTowerPosition(config, model, plates, -1);
    assignInstancesToPlates(model, plates, config);

    return listPlates(model, plates, config);
}

nlohmann::json duplicatePlate(
    const nlohmann::json& args,
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    Slic3r::DynamicPrintConfig& config
) {
    listPlates(model, plates, config);
    const int index = args.at("plateIndex").get<int>();
    if (index < 0 || static_cast<size_t>(index) >= plates.size())
        throw Slic3r::RuntimeError("Invalid plateIndex");
    const auto* source = plates[index];
    const auto plate_config = source->config;
    const auto filament_maps = source->filament_maps;
    const auto name = source->plate_name;
    double width, depth, height;
    getBedDimensions(config, width, depth, height);
    const auto origin = computePlateOrigin(index, plates.size(), width, depth);
    std::map<int, std::set<int>> selected;
    for (const auto& ref : source->objects_and_instances) selected[ref.first].insert(ref.second);
    Slic3r::Model snapshot;
    for (const auto& entry : selected) {
        const auto* object = model.objects.at(entry.first);
        auto* copy = snapshot.add_object(*object);
        for (size_t i = object->instances.size(); i-- > 0;)
            if (entry.second.count(static_cast<int>(i)) == 0) copy->delete_instance(i);
    }
    // Adding a plate can change the grid's column count and move existing
    // instances. The snapshot retains their original plate-local positions.
    addPlate({{"name", name + " (copy)"}}, model, plates, config);
    auto* target = plates.back();
    target->config = plate_config;
    target->filament_maps = filament_maps;
    const Slic3r::Vec3d shift = computePlateOrigin(target->plate_index, plates.size(), width, depth) - origin;
    for (const auto* object : snapshot.objects) {
        auto* copy = model.add_object(*object);
        copy->translate_instances(shift);
    }
    return listPlates(model, plates, config);
}

nlohmann::json deletePlate(
    const nlohmann::json& args,
    Slic3r::Model& model,
    Slic3r::PlateDataPtrs& plates,
    Slic3r::DynamicPrintConfig& config
) {
    if (plates.size() <= 1) {
        throw Slic3r::RuntimeError("Cannot delete the only plate");
    }

    int del_idx = -1;
    if (args.contains("plateIndex")) {
        del_idx = args["plateIndex"].get<int>();
    } else if (args.contains("index")) {
        del_idx = args["index"].get<int>();
    } else {
        throw Slic3r::RuntimeError("deletePlate requires plateIndex");
    }

    if (del_idx < 0 || del_idx >= static_cast<int>(plates.size())) {
        throw Slic3r::RuntimeError("Invalid plateIndex: " + std::to_string(del_idx));
    }

    double bed_width, bed_depth, bed_height;
    getBedDimensions(config, bed_width, bed_depth, bed_height);

    assignInstancesToPlates(model, plates, config);

    bool delete_objects = args.value("deleteObjects", false);
    size_t old_count = plates.size();
    size_t new_count = old_count - 1;

    auto* del_plate = plates[del_idx];
    auto del_instances = del_plate->objects_and_instances;

    if (delete_objects) {
        std::map<int, std::vector<int>> to_remove;
        for (const auto& pair : del_instances) {
            to_remove[pair.first].push_back(pair.second);
        }
        for (auto& [obj_idx, inst_indices] : to_remove) {
            if (obj_idx >= 0 && static_cast<size_t>(obj_idx) < model.objects.size()) {
                auto* obj = model.objects[obj_idx];
                std::sort(inst_indices.rbegin(), inst_indices.rend());
                for (int ii : inst_indices) {
                    if (ii >= 0 && static_cast<size_t>(ii) < obj->instances.size()) {
                        obj->delete_instance(ii);
                    }
                }
            }
        }
        for (int oi = static_cast<int>(model.objects.size()) - 1; oi >= 0; --oi) {
            if (model.objects[oi]->instances.empty()) {
                model.delete_object(oi);
            }
        }
    } else {
        int dest_idx = (del_idx > 0) ? (del_idx - 1) : 0;
        Slic3r::Vec3d del_origin = computePlateOrigin(del_idx, old_count, bed_width, bed_depth);
        Slic3r::Vec3d dest_origin = computePlateOrigin(dest_idx, new_count, bed_width, bed_depth);
        Slic3r::Vec3d shift = dest_origin - del_origin;
        for (const auto& pair : del_instances) {
            if (pair.first >= 0 && static_cast<size_t>(pair.first) < model.objects.size()) {
                auto* o = model.objects[pair.first];
                if (pair.second >= 0 && static_cast<size_t>(pair.second) < o->instances.size()) {
                    auto* inst = o->instances[pair.second];
                    inst->set_offset(inst->get_offset() + shift);
                }
            }
        }
    }

    for (size_t i = 0; i < old_count; ++i) {
        if (static_cast<int>(i) == del_idx) continue;
        int target_idx = (static_cast<int>(i) > del_idx) ? (static_cast<int>(i) - 1) : static_cast<int>(i);
        Slic3r::Vec3d old_origin = computePlateOrigin(static_cast<int>(i), old_count, bed_width, bed_depth);
        Slic3r::Vec3d new_origin = computePlateOrigin(target_idx, new_count, bed_width, bed_depth);
        Slic3r::Vec3d shift = new_origin - old_origin;
        if (!Slic3r::is_approx(shift.norm(), 0.0)) {
            for (const auto& pair : plates[i]->objects_and_instances) {
                if (pair.first >= 0 && static_cast<size_t>(pair.first) < model.objects.size()) {
                    auto* o = model.objects[pair.first];
                    if (pair.second >= 0 && static_cast<size_t>(pair.second) < o->instances.size()) {
                        auto* inst = o->instances[pair.second];
                        inst->set_offset(inst->get_offset() + shift);
                    }
                }
            }
        }
    }

    delete del_plate;
    plates.erase(plates.begin() + del_idx);
    for (size_t i = 0; i < plates.size(); ++i) {
        plates[i]->plate_index = static_cast<int>(i);
    }

    updateWipeTowerPosition(config, model, plates, -1);
    assignInstancesToPlates(model, plates, config);

    return listPlates(model, plates, config);
}

nlohmann::json setPlateConfig(
    const nlohmann::json& args,
    Slic3r::PlateDataPtrs& plates
) {
    int idx = -1;
    if (args.contains("plateIndex")) {
        idx = args["plateIndex"].get<int>();
    } else if (args.contains("index")) {
        idx = args["index"].get<int>();
    } else {
        throw Slic3r::RuntimeError("setPlateConfig requires plateIndex");
    }

    if (idx < 0 || idx >= static_cast<int>(plates.size())) {
        throw Slic3r::RuntimeError("Invalid plateIndex: " + std::to_string(idx));
    }

    auto* plate = plates[idx];
    if (args.contains("name") && args["name"].is_string()) {
        plate->plate_name = args["name"].get<std::string>();
    }
    if (args.contains("locked") && args["locked"].is_boolean()) {
        plate->locked = args["locked"].get<bool>();
    }
    if (args.contains("config") && args["config"].is_object()) {
        for (const auto& [k, v] : args["config"].items()) {
            std::string sval = v.is_string() ? v.get<std::string>() : v.dump();
            try {
                plate->config.set_deserialize_strict(k, sval);
            } catch (...) {}
        }
    }

    return nlohmann::json::object();
}

} // namespace OrcaEngine
