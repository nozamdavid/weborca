#include "EditOps.hpp"
#include "Engine.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Orient.hpp"
#include "libslic3r/LayOnFace.hpp"
#include "libslic3r/QuadricEdgeCollapse.hpp"
#include "libslic3r/MeshBoolean.hpp"
#include "libslic3r/TriangleSelector.hpp"
#include "libslic3r/TextureDisplacement.hpp"
#include <iostream>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {
Slic3r::ModelObject* find_object(const Slic3r::Model& model, size_t id) {
    for (auto* obj : model.objects) {
        if (obj->id().id == id) return obj;
    }
    return nullptr;
}

Slic3r::ModelVolume* find_volume(const Slic3r::ModelObject* obj, size_t id) {
    for (auto* vol : obj->volumes) {
        if (vol->id().id == id) return vol;
    }
    return nullptr;
}
}

json autoOrient(Slic3r::Model& model, const json& args) {
    auto object_ids = args.at("objectIds").get<std::vector<size_t>>();
    
    std::vector<Slic3r::orientation::OrientMesh> selected;
    
    json rotations = json::array();

    for (auto oid : object_ids) {
        Slic3r::ModelObject* obj = find_object(model, oid);
        if (!obj) continue;
        for (auto* instance : obj->instances) {
            Slic3r::orientation::OrientMesh om;
            om.mesh = obj->mesh();
            om.overhang_angle = obj->config.has("support_threshold_angle") ? obj->config.opt_int("support_threshold_angle") : 30;
            
            // We use a setter to grab the rotation matrix later
            size_t iid = instance->id().id;
            om.setter = [&rotations, oid, iid, instance](const Slic3r::orientation::OrientMesh &m) {
                // Apply exactly as desktop OrientJob.cpp does
                instance->rotate(m.rotation_matrix);
                instance->rotate(m.rotation_matrix_vertical);
                instance->get_object()->invalidate_bounding_box();
                instance->get_object()->ensure_on_bed();
                
                // Construct the combined 3x3 rotation matrix
                Slic3r::Matrix3d mat = m.rotation_matrix_vertical * m.rotation_matrix;
                rotations.push_back({
                    {"objectId", oid},
                    {"instanceId", iid},
                    {"matrix", {
                        mat(0,0), mat(0,1), mat(0,2),
                        mat(1,0), mat(1,1), mat(1,2),
                        mat(2,0), mat(2,1), mat(2,2)
                    }}
                });
            };
            selected.push_back(om);
        }
    }
    
    Slic3r::orientation::OrientParams params;
    params.min_volume = true; params.stopcondition = [](){ return false; }; params.progressind = [](unsigned, std::string){};
    
    std::vector<Slic3r::orientation::OrientMesh> unselected;
    Slic3r::orientation::orient(selected, unselected, params);
    
    for (const auto& om : selected) {
        om.apply();
    }
    
    return json{{"success", true}, {"rotations", rotations}};
}

json getPlanarFacets(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    
    Slic3r::ModelInstance* instance = nullptr;
    if (args.contains("instanceId")) {
        size_t iid = args["instanceId"].get<size_t>();
        for (auto* inst : obj->instances) {
            if (inst->id().id == iid) { instance = inst; break; }
        }
    }
    if (!instance && !obj->instances.empty()) {
        instance = obj->instances.front();
    }
    if (!instance) throw Slic3r::RuntimeError("No instance found");
    
    Slic3r::Transform3d inst_matrix = instance->get_matrix_no_offset();
    auto planes = Slic3r::lay_on_face_planes(*obj, inst_matrix);
    
    json clusters = json::array();
    for (const auto& p : planes) {
        json outline = json::array();
        const Slic3r::Transform3d to_mesh = inst_matrix.inverse() * p.to_plane_frame.inverse();
        for (const auto& pt : p.outline) {
            const Slic3r::Vec3d vertex = to_mesh * pt;
            outline.push_back({vertex.x(), vertex.y(), vertex.z()});
        }
        clusters.push_back({
            {"normal", {p.normal.x(), p.normal.y(), p.normal.z()}},
            {"center", {p.center.x(), p.center.y(), p.center.z()}},
            {"area", p.area},
            {"outline", outline}
        });
    }
    
    return json{{"success", true}, {"clusters", clusters}};
}

json placeOnFace(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    size_t facet_index = args.at("facetIndex").get<size_t>();
    
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    
    Slic3r::ModelInstance* instance = nullptr;
    size_t instance_idx = 0;
    if (args.contains("instanceId")) {
        size_t iid = args["instanceId"].get<size_t>();
        for (size_t i = 0; i < obj->instances.size(); ++i) {
            if (obj->instances[i]->id().id == iid) {
                instance = obj->instances[i];
                instance_idx = i;
                break;
            }
        }
    } else if (!obj->instances.empty()) {
        instance = obj->instances.front();
    }
    if (!instance) throw Slic3r::RuntimeError("No instance found");
    
    Slic3r::Transform3d inst_matrix = instance->get_matrix_no_offset();
    auto planes = Slic3r::lay_on_face_planes(*obj, inst_matrix);
    
    if (facet_index >= planes.size()) throw Slic3r::RuntimeError("Invalid facet index");
    
    Slic3r::lay_on_face(*obj, instance_idx, planes[facet_index].normal);
    
    return json{{"success", true}};
}

json splitObject(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    
    size_t target_idx = (size_t)-1;
    for (size_t i = 0; i < model.objects.size(); ++i) {
        if (model.objects[i]->id().id == object_id) { target_idx = i; break; }
    }
    if (target_idx == (size_t)-1) throw Slic3r::RuntimeError("Object not found");
    
    Slic3r::Model candidate(model);
    Slic3r::ModelObject* candidate_obj = candidate.objects[target_idx];
    
    Slic3r::ModelObjectPtrs new_objects;
    candidate_obj->split(&new_objects, true); // true = remap_paint
    
    if (new_objects.size() <= 1) {
        for (auto* obj : new_objects) candidate.delete_object(obj);
        return json{{"success", false}, {"error", "Object could not be split"}};
    }
    
    candidate.delete_object(candidate_obj);
    
    std::vector<size_t> new_ids;
    for (auto* obj : new_objects) new_ids.push_back(obj->id().id);
    
    model = std::move(candidate);
    
    return json{{"success", true}, {"newObjectIds", new_ids}};
}

json splitVolume(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    auto volume_id = args.at("volumeId").get<size_t>();
    
    size_t target_idx = (size_t)-1;
    for (size_t i = 0; i < model.objects.size(); ++i) {
        if (model.objects[i]->id().id == object_id) { target_idx = i; break; }
    }
    if (target_idx == (size_t)-1) throw Slic3r::RuntimeError("Object not found");
    
    Slic3r::Model candidate(model);
    Slic3r::ModelObject* candidate_obj = candidate.objects[target_idx];
    
    size_t vol_idx = (size_t)-1;
    for (size_t i = 0; i < candidate_obj->volumes.size(); ++i) {
        if (candidate_obj->volumes[i]->id().id == volume_id) { vol_idx = i; break; }
    }
    if (vol_idx == (size_t)-1) throw Slic3r::RuntimeError("Volume not found");
    
    Slic3r::ModelVolume* target_vol = candidate_obj->volumes[vol_idx];
    std::vector<Slic3r::TriangleMesh> meshes = target_vol->mesh().split();
    
    if (meshes.size() <= 1) {
        return json{{"success", false}, {"error", "Volume could not be split"}};
    }
    
    if (target_vol->text_configuration.has_value()) {
        target_vol->text_configuration.reset();
    }
    
    std::optional<Slic3r::TriangleSelector::SavedPainting> saved_painting = target_vol->save_painting();
    
    std::string name = target_vol->name;
    Slic3r::Vec3d offset = target_vol->get_offset();
    int extruder_id = target_vol->extruder_id();
    
    std::vector<size_t> new_ids;
    std::vector<Slic3r::ModelVolume*> added_vols;
    
    size_t inserted = 0;
    for (size_t i = 0; i < meshes.size(); ++i) {
        if (meshes[i].empty()) continue;
        
        if (inserted == 0) {
            target_vol->set_mesh(std::move(meshes[i]));
            target_vol->calculate_convex_hull();
            target_vol->invalidate_convex_hull_2d();
            target_vol->set_new_unique_id();
            target_vol->source = Slic3r::ModelVolume::Source();
            target_vol->reset_extra_facets();
            new_ids.push_back(target_vol->id().id);
            added_vols.push_back(target_vol);
        } else {
            Slic3r::ModelVolume* new_vol = candidate_obj->add_volume(*target_vol, std::move(meshes[i]));
            new_vol->set_offset(Slic3r::Vec3d::Zero());
            new_vol->center_geometry_after_creation();
            new_vol->translate(offset);
            new_vol->name = name + "_" + std::to_string(inserted + 1);
            new_vol->config.set("extruder", extruder_id);
            new_vol->restore_painting(saved_painting);
            new_ids.push_back(new_vol->id().id);
            added_vols.push_back(new_vol);
        }
        inserted++;
    }
    
    // Now remove only the volumes from OUR split if they lack convex hulls
    for (auto* vol : added_vols) {
        const auto& hull = vol->get_convex_hull_shared_ptr();
        if (hull == nullptr || hull->its.vertices.empty() || hull->its.indices.empty()) {
            for (size_t k = 0; k < candidate_obj->volumes.size(); ++k) { if (candidate_obj->volumes[k] == vol) { candidate_obj->delete_volume(k); break; } }
            auto it = std::find(new_ids.begin(), new_ids.end(), vol->id().id);
            if (it != new_ids.end()) new_ids.erase(it);
        }
    }
    
    model = std::move(candidate);
    
    return json{{"success", true}, {"newVolumeIds", new_ids}};
}

json simplifyVolume(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    auto volume_id = args.at("volumeId").get<size_t>();
    
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    Slic3r::ModelVolume* vol = find_volume(obj, volume_id);
    if (!vol) throw Slic3r::RuntimeError("Volume not found");
    
    size_t before_count = vol->mesh().facets_count();
    uint32_t target_count = 0;
    float max_error = 0.0f;
    float* max_error_ptr = nullptr;
    
    if (args.contains("targetTriangleCount")) {
        target_count = args["targetTriangleCount"].get<uint32_t>();
    } else if (args.contains("ratio")) {
        target_count = static_cast<uint32_t>(before_count * args["ratio"].get<float>());
    } else if (args.contains("maxError")) {
        max_error = args["maxError"].get<float>();
        max_error_ptr = &max_error;
    } else {
        throw Slic3r::RuntimeError("Must provide targetTriangleCount, ratio, or maxError");
    }
    
    bool keep_painting = args.value("keepPainting", true);
    std::optional<Slic3r::TriangleSelector::SavedPainting> saved_painting;
    if (keep_painting) {
        saved_painting = vol->save_painting();
    }
    
    indexed_triangle_set its = vol->mesh().its;
    
    auto cancel_fn = []() {};
    auto status_fn = [](int) {};
    
    Slic3r::its_quadric_edge_collapse(its, target_count, max_error_ptr, cancel_fn, status_fn);
    
    vol->set_mesh(Slic3r::TriangleMesh(std::move(its)));
    if (keep_painting) {
        vol->restore_painting(saved_painting);
    }
    vol->calculate_convex_hull();
    vol->invalidate_convex_hull_2d();
    vol->set_new_unique_id();
    vol->get_object()->invalidate_bounding_box();
    vol->get_object()->ensure_on_bed();
    
    return json{
        {"success", true},
        {"triangleCountBefore", before_count},
        {"triangleCountAfter", vol->mesh().facets_count()},
        {"maxError", max_error}
    };
}

json textureDisplace(Slic3r::Model& model, const json& args) {
    auto* obj = find_object(model, args.at("objectId").get<size_t>());
    if (!obj) throw Slic3r::RuntimeError("Object not found");
    auto* vol = find_volume(obj, args.at("volumeId").get<size_t>());
    if (!vol || !vol->is_model_part()) throw Slic3r::RuntimeError("Select a model part");
    if (obj->instances.size() != 1 || !vol->texture_uv.empty() ||
        !vol->supported_facets.empty() || !vol->seam_facets.empty() ||
        !vol->mmu_segmentation_facets.empty() || !vol->fuzzy_skin_facets.empty() ||
        !vol->texture_displacement_facets_all_empty())
        throw Slic3r::RuntimeError("Bake requires one instance and an unpainted part without UV coordinates");
    Slic3r::TextureDisplacementLayer layer;
    layer.slot = 0;
    layer.depth_mm = args.at("depth").get<float>();
    layer.tiling_scale = args.at("tileSize").get<float>();
    layer.rotation_deg = args.value("rotation", 0.f);
    layer.midlevel = args.value("midlevel", 0.f);
    layer.invert = args.value("invert", false);
    int projection = args.value("projection", 0);
    if (!std::isfinite(layer.depth_mm) || layer.depth_mm <= 0 || layer.depth_mm > 5 ||
        !std::isfinite(layer.tiling_scale) || layer.tiling_scale < 0.5f || layer.tiling_scale > 1000 ||
        !std::isfinite(layer.rotation_deg) || !std::isfinite(layer.midlevel) ||
        layer.midlevel < 0 || layer.midlevel > 1 || projection < 0 || projection > 2)
        throw Slic3r::RuntimeError("Invalid texture displacement settings");
    layer.projection_method = static_cast<Slic3r::TextureProjectionMethod>(projection);
    auto bytes = args.at("image").get<std::vector<unsigned char>>();
    if (bytes.empty() || bytes.size() > 8 * 1024 * 1024)
        throw Slic3r::RuntimeError("Texture must be a PNG smaller than 8 MB");
    // Check IHDR before the decoder allocates buffers from untrusted dimensions.
    const unsigned char png_header[] = {137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 'I', 'H', 'D', 'R'};
    if (bytes.size() < 33 || !std::equal(std::begin(png_header), std::end(png_header), bytes.begin()))
        throw Slic3r::RuntimeError("Cannot decode texture image: invalid PNG header");
    const auto dimension = [&](size_t offset) {
        return (uint32_t(bytes[offset]) << 24) | (uint32_t(bytes[offset + 1]) << 16) |
               (uint32_t(bytes[offset + 2]) << 8) | uint32_t(bytes[offset + 3]);
    };
    const auto width = dimension(16), height = dimension(20);
    if (width == 0 || height == 0 || width > 2048 || height > 2048)
        throw Slic3r::RuntimeError("Texture dimensions must be at most 2048 x 2048 pixels");
    layer.image_data = std::make_shared<std::vector<unsigned char>>(std::move(bytes));
    const auto decoded = Slic3r::decode_height_texture(layer);
    if (decoded.empty())
        throw Slic3r::RuntimeError("Cannot decode texture image");
    if (std::all_of(decoded.pixels.begin(), decoded.pixels.end(), [&](uint8_t p) {
            return std::abs(float(p) / 255.f - layer.midlevel) < 1e-6f;
        })) throw Slic3r::RuntimeError("Texture has no relief at this neutral height; nothing changed");
    Slic3r::TriangleSelector selector(vol->mesh());
    for (size_t i = 0; i < vol->mesh().facets_count(); ++i)
        selector.set_facet(int(i), Slic3r::EnforcerBlockerType::ENFORCER);
    Slic3r::TextureDisplacementFacetsData masks;
    masks[0] = selector.serialize();
    Slic3r::TextureDisplacementOptions options;
    options.v2_max_triangles_k = 200;
    auto transform = vol->get_matrix();
    if (!obj->instances.empty()) transform = obj->instances.front()->get_matrix() * transform;
    auto mesh = Slic3r::build_texture_displacement(vol->mesh().its, {layer}, masks, options, {}, nullptr, transform);
    if (mesh.indices.empty()) throw Slic3r::RuntimeError("Texture produced no displacement; nothing changed");
    vol->set_mesh(Slic3r::TriangleMesh(std::move(mesh)));
    vol->calculate_convex_hull();
    vol->invalidate_convex_hull_2d();
    vol->set_new_unique_id();
    obj->invalidate_bounding_box();
    obj->ensure_on_bed();
    return {{"success", true}, {"triangleCountAfter", vol->mesh().facets_count()}};
}

json meshBoolean(Slic3r::Model& model, const json& args) {
    std::string mode = args.at("mode").get<std::string>();
    auto target_id = args.at("targetObjectId").get<size_t>();
    auto tool_ids = args.at("toolObjectIds").get<std::vector<size_t>>();
    bool keep_tools = args.value("keepTools", false);
    
    size_t target_idx = (size_t)-1;
    for (size_t i = 0; i < model.objects.size(); ++i) {
        if (model.objects[i]->id().id == target_id) { target_idx = i; break; }
    }
    if (target_idx == (size_t)-1) throw Slic3r::RuntimeError("Target object not found");
    
    Slic3r::Model candidate(model);
    Slic3r::ModelObject* target_obj = candidate.objects[target_idx];
    
    Slic3r::TriangleMesh target_mesh = target_obj->raw_mesh(); // mesh() would apply the instance transform a second time
    Slic3r::Transform3d target_inv = target_obj->instances.empty() ? 
        Slic3r::Transform3d::Identity() : target_obj->instances.front()->get_matrix().inverse();
    
    for (auto tool_id : tool_ids) {
        Slic3r::ModelObject* tool_obj = find_object(candidate, tool_id);
        if (!tool_obj) continue;
        
        Slic3r::TriangleMesh tool_mesh = tool_obj->raw_mesh();
        Slic3r::Transform3d tool_mat = tool_obj->instances.empty() ? 
            Slic3r::Transform3d::Identity() : tool_obj->instances.front()->get_matrix();
            
        Slic3r::Transform3d t2t = target_inv * tool_mat;
        tool_mesh.transform(t2t);
        
        if (mode == "union") {
            Slic3r::MeshBoolean::cgal::plus(target_mesh, tool_mesh);
        } else if (mode == "difference") {
            Slic3r::MeshBoolean::cgal::minus(target_mesh, tool_mesh);
        } else if (mode == "intersection") {
            Slic3r::MeshBoolean::cgal::intersect(target_mesh, tool_mesh);
        } else {
            throw Slic3r::RuntimeError("Invalid boolean mode");
        }
    }
    
    if (target_mesh.empty() || target_mesh.its.indices.empty()) {
        return json{{"success", false}, {"error", "Resulting mesh is empty"}};
    }
    
    target_obj->clear_volumes();
    Slic3r::ModelVolume* new_vol = target_obj->add_volume(std::move(target_mesh), Slic3r::ModelVolumeType::MODEL_PART);
    new_vol->config.set_key_value("extruder", new Slic3r::ConfigOptionInt(1));
    new_vol->name = "Boolean Result";
    target_obj->invalidate_bounding_box();
    
    if (!keep_tools) {
        for (auto tool_id : tool_ids) {
            Slic3r::ModelObject* tool_obj = find_object(candidate, tool_id);
            if (tool_obj) candidate.delete_object(tool_obj);
        }
    }
    
    model = std::move(candidate);
    
    return json{
        {"success", true},
        {"objectId", target_id},
        {"volumeId", new_vol->id().id}
    };
}

} // namespace OrcaWasm
