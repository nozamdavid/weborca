#include "RepairOps.hpp"

#include "libslic3r/libslic3r.h"
#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/MeshRepair.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/Point.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/TriangleSelector.hpp"
#include "libslic3r/Utils.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <string>
#include <vector>
#include <utility>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {

const Slic3r::ModelObject* find_object(const Slic3r::Model& model, size_t object_id) {
    for (const auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

Slic3r::ModelObject* find_object(Slic3r::Model& model, size_t object_id) {
    for (auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

size_t extract_object_id(const json& args, const char* op_name) {
    if (args.contains("objectId") && !args["objectId"].is_null()) {
        return args["objectId"].get<size_t>();
    } else if (args.contains("id") && !args["id"].is_null()) {
        return args["id"].get<size_t>();
    }
    throw Slic3r::RuntimeError(std::string(op_name) + " requires objectId");
}

json evaluate_volume_health(const Slic3r::ModelVolume& vol, size_t volume_idx) {
    const auto& mesh = vol.mesh();
    size_t open_edges = Slic3r::its_num_open_edges(mesh.its);
    size_t shells = Slic3r::its_number_of_patches(mesh.its);

    indexed_triangle_set tmp = mesh.its;
    int degenerate_faces = Slic3r::its_remove_degenerate_faces(tmp, false);

    const auto& stats = mesh.stats();
    int facets_reversed = stats.repaired_errors.facets_reversed;
    int edges_fixed = stats.repaired_errors.edges_fixed;
    int facets_removed = stats.repaired_errors.facets_removed;
    int backwards_edges = stats.repaired_errors.backwards_edges;

    float volume = Slic3r::its_volume(mesh.its);
    auto bb = mesh.bounding_box();

    bool is_manifold = !mesh.empty() && open_edges == 0 && degenerate_faces == 0;

    return {
        {"volumeId", vol.id().id},
        {"volumeIndex", volume_idx},
        {"name", vol.name},
        {"isManifold", is_manifold},
        {"openEdges", open_edges},
        {"facetsCount", mesh.its.indices.size()},
        {"numberOfParts", shells},
        {"degenerateFacets", degenerate_faces},
        {"facetsReversed", facets_reversed},
        {"edgesFixed", edges_fixed},
        {"facetsRemoved", facets_removed},
        {"backwardsEdges", backwards_edges},
        {"volume", volume},
        {"boundingBox", {
            bb.min.x(), bb.min.y(), bb.min.z(),
            bb.max.x(), bb.max.y(), bb.max.z()
        }}
    };
}

std::vector<size_t> resolve_target_volumes(
    const Slic3r::ModelObject& obj,
    const json& args
) {
    std::vector<size_t> indices;
    if (args.contains("volumeId") && !args["volumeId"].is_null()) {
        size_t target_vol_id = args["volumeId"].get<size_t>();
        for (size_t i = 0; i < obj.volumes.size(); ++i) {
            if (obj.volumes[i] && obj.volumes[i]->id().id == target_vol_id) {
                indices.push_back(i);
                break;
            }
        }
        if (indices.empty()) {
            throw Slic3r::RuntimeError("Volume not found: " + std::to_string(target_vol_id));
        }
    } else if (args.contains("volumeIndex") && !args["volumeIndex"].is_null()) {
        size_t idx = args["volumeIndex"].get<size_t>();
        if (idx >= obj.volumes.size() || !obj.volumes[idx]) {
            throw Slic3r::RuntimeError("Invalid volumeIndex: " + std::to_string(idx));
        }
        indices.push_back(idx);
    } else {
        for (size_t i = 0; i < obj.volumes.size(); ++i) {
            if (obj.volumes[i])
                indices.push_back(i);
        }
    }
    return indices;
}

} // namespace

json getMeshHealth(
    const Slic3r::Model& model,
    const json& args
) {
    size_t object_id = extract_object_id(args, "getMeshHealth");
    const auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    std::vector<size_t> target_indices = resolve_target_volumes(*obj, args);

    size_t total_open_edges = 0;
    size_t total_facets = 0;
    size_t total_parts = 0;
    int total_degenerate = 0;
    int total_reversed = 0;
    int total_edges_fixed = 0;
    int total_facets_removed = 0;
    double total_volume = 0.0;
    bool all_manifold = !target_indices.empty();

    json volumes_json = json::array();
    for (size_t vi : target_indices) {
        const auto* vol = obj->volumes[vi];
        json v_health = evaluate_volume_health(*vol, vi);
        total_open_edges += v_health["openEdges"].get<size_t>();
        total_facets += v_health["facetsCount"].get<size_t>();
        total_parts += v_health["numberOfParts"].get<size_t>();
        total_degenerate += v_health["degenerateFacets"].get<int>();
        total_reversed += v_health["facetsReversed"].get<int>();
        total_edges_fixed += v_health["edgesFixed"].get<int>();
        total_facets_removed += v_health["facetsRemoved"].get<int>();
        total_volume += v_health["volume"].get<double>();
        if (!v_health["isManifold"].get<bool>()) {
            all_manifold = false;
        }
        volumes_json.push_back(std::move(v_health));
    }

    auto obj_bb = obj->bounding_box_exact();

    return {
        {"success", true},
        {"objectId", obj->id().id},
        {"isManifold", all_manifold},
        {"openEdges", total_open_edges},
        {"facetsCount", total_facets},
        {"numberOfParts", total_parts},
        {"degenerateFacets", total_degenerate},
        {"facetsReversed", total_reversed},
        {"edgesFixed", total_edges_fixed},
        {"facetsRemoved", total_facets_removed},
        {"volume", total_volume},
        {"boundingBox", {
            obj_bb.min.x(), obj_bb.min.y(), obj_bb.min.z(),
            obj_bb.max.x(), obj_bb.max.y(), obj_bb.max.z()
        }},
        {"volumes", volumes_json}
    };
}

static json repair_object_candidate(
    Slic3r::Model& model,
    const json& args
) {
    size_t object_id = extract_object_id(args, "repairObject");
    auto* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }

    std::vector<size_t> target_indices = resolve_target_volumes(*obj, args);
    if (target_indices.empty()) {
        throw Slic3r::RuntimeError("No volumes available to repair on object " + std::to_string(object_id));
    }

    bool keep_painting = args.value("keepPainting", true);
    for (size_t vi : target_indices) {
        if (keep_painting && obj->volumes[vi]->is_texture_displacement_painted())
            throw Slic3r::RuntimeError("Texture displacement painting cannot be remapped; use keepPainting:false to discard it");
    }
    if (args.value("splitParts", false))
        throw Slic3r::RuntimeError("splitParts is not supported: upstream split may delete unrelated volumes");

    // 1. Gather baseline stats before repair
    size_t total_open_edges_before = 0;
    size_t total_facets_before = 0;
    size_t total_parts_before = 0;
    int total_degenerate_before = 0;
    int total_reversed_before = 0;
    double total_volume_before = 0.0;

    for (size_t vi : target_indices) {
        const auto* vol = obj->volumes[vi];
        json v_h = evaluate_volume_health(*vol, vi);
        total_open_edges_before += v_h["openEdges"].get<size_t>();
        total_facets_before += v_h["facetsCount"].get<size_t>();
        total_parts_before += v_h["numberOfParts"].get<size_t>();
        total_degenerate_before += v_h["degenerateFacets"].get<int>();
        total_reversed_before += v_h["facetsReversed"].get<int>();
        total_volume_before += v_h["volume"].get<double>();
    }

    // 2. Perform transactional repair on cloned meshes
    // If any volume repair fails, we abort without modifying the model.
    struct RepairedEntry {
        size_t volume_index;
        Slic3r::TriangleMesh mesh;
        bool identical_geometry;
    };

    std::vector<RepairedEntry> repaired_entries;
    repaired_entries.reserve(target_indices.size());

    int aggregated_edges_fixed = 0;
    size_t aggregated_facets_removed = 0;
    int aggregated_degenerate_fixed = 0;
    bool geometry_changed = false;

    for (size_t vi : target_indices) {
        auto* vol = obj->volumes[vi];
        Slic3r::TriangleMesh candidate_mesh = vol->mesh();
        Slic3r::MeshRepairStats repair_stats{};
        int degenerate_removed = 0;
        std::string error_msg;

        // Run CGAL repair pipeline
        bool ok = Slic3r::repair_mesh(candidate_mesh, &repair_stats, &error_msg);

        // If initial CGAL repair reported issues, attempt pre-cleaning soup and retry
        if (!ok) {
            indexed_triangle_set cleaned = vol->mesh().its;
            int removed_deg = Slic3r::its_remove_degenerate_faces(cleaned, true);
            Slic3r::its_merge_vertices(cleaned, true);
            Slic3r::its_compactify_vertices(cleaned, true);

            Slic3r::TriangleMesh fallback_mesh{std::move(cleaned)};
            std::string retry_error;
            Slic3r::MeshRepairStats retry_stats{};
            ok = Slic3r::repair_mesh(fallback_mesh, &retry_stats, &retry_error);
            if (ok) {
                candidate_mesh = std::move(fallback_mesh);
                repair_stats = retry_stats;
                repair_stats.removed_triangles += removed_deg;
                degenerate_removed = removed_deg;
            } else {
                error_msg = retry_error.empty() ? error_msg : retry_error;
            }
        }

        if (!ok || candidate_mesh.empty()) {
            // Transactional rollback: leave model object untouched and report failure
            return {
                {"success", false},
                {"wasRepaired", false},
                {"objectId", obj->id().id},
                {"error", error_msg.empty() ? "CGAL repair could not close mesh" : error_msg},
                {"openEdgesBefore", total_open_edges_before},
                {"openEdgesAfter", total_open_edges_before},
                {"degenerateFacetsBefore", total_degenerate_before},
                {"degenerateFacetsAfter", total_degenerate_before}
            };
        }

        // The new pipeline counts removed triangles, not repaired edges. Keep
        // edgesFixed at zero rather than treating welded vertices as edges.
        aggregated_facets_removed += repair_stats.removed_triangles;
        aggregated_degenerate_fixed += degenerate_removed;
        const auto& before = vol->mesh().its;
        const auto& after = candidate_mesh.its;
        const bool identical_geometry = before.indices == after.indices && before.vertices == after.vertices;
        geometry_changed |= repair_stats.modified || !identical_geometry;

        repaired_entries.push_back({vi, std::move(candidate_mesh), identical_geometry});
    }

    // 3. Apply repaired meshes to target volumes with painting and transform preservation
    for (auto& entry : repaired_entries) {
        auto* vol = obj->volumes[entry.volume_index];

        // Exact vertex and index ordering is unchanged: retain the original
        // annotations rather than sending them through a lossy spatial remap.
        if (entry.identical_geometry) {
            if (!keep_painting) vol->reset_extra_facets();
            vol->set_new_unique_id();
            continue;
        }

        const std::optional<Slic3r::TriangleSelector::SavedPainting> saved_painting =
            keep_painting ? vol->save_painting() : std::nullopt;

        vol->set_mesh(std::move(entry.mesh));
        vol->calculate_convex_hull();
        vol->invalidate_convex_hull_2d();
        vol->set_new_unique_id();

        vol->restore_painting(saved_painting);
    }

    obj->invalidate_bounding_box();

    // 4. Compute updated health metrics after repair
    json health_args = {{"objectId", object_id}};
    if ((args.contains("volumeId") && !args["volumeId"].is_null()) ||
        (args.contains("volumeIndex") && !args["volumeIndex"].is_null()))
        health_args["volumeIndex"] = target_indices.front();
    json health_after = getMeshHealth(model, health_args);

    size_t total_open_edges_after = health_after["openEdges"].get<size_t>();
    size_t total_facets_after = health_after["facetsCount"].get<size_t>();
    size_t total_parts_after = health_after["numberOfParts"].get<size_t>();
    int total_degenerate_after = health_after["degenerateFacets"].get<int>();
    double total_volume_after = health_after["volume"].get<double>();
    bool is_manifold_after = health_after["isManifold"].get<bool>();

    bool was_repaired = (geometry_changed ||
        total_open_edges_before != total_open_edges_after ||
        total_facets_before != total_facets_after ||
        total_degenerate_before != total_degenerate_after ||
        total_volume_before != total_volume_after ||
        aggregated_edges_fixed > 0 ||
        aggregated_facets_removed > 0
    );

    int degenerate_fixed = std::max(0, total_degenerate_before - total_degenerate_after);
    if (degenerate_fixed == 0 && aggregated_degenerate_fixed > 0) {
        degenerate_fixed = aggregated_degenerate_fixed;
    }

    return {
        {"success", true},
        {"wasRepaired", was_repaired},
        {"objectId", obj->id().id},
        {"isManifold", is_manifold_after},
        {"openEdgesBefore", total_open_edges_before},
        {"openEdgesAfter", total_open_edges_after},
        {"degenerateFacetsBefore", total_degenerate_before},
        {"degenerateFacetsAfter", total_degenerate_after},
        {"degenerateFacetsFixed", degenerate_fixed},
        {"edgesFixed", aggregated_edges_fixed},
        {"facetsRemoved", aggregated_facets_removed},
        {"facetsBefore", total_facets_before},
        {"facetsAfter", total_facets_after},
        {"volumeBefore", total_volume_before},
        {"volumeAfter", total_volume_after},
        {"numberOfPartsBefore", total_parts_before},
        {"numberOfPartsAfter", total_parts_after},
        {"volumes", health_after["volumes"]}
    };
}

json repairObject(Slic3r::Model& model, const json& args)
{
    // Include annotation remapping, hull construction and result serialization in
    // the transaction. CGAL succeeding alone does not make those steps infallible.
    Slic3r::Model candidate(model);
    json result = repair_object_candidate(candidate, args);
    if (result.value("success", false))
        model = std::move(candidate);
    return result;
}

json checkMeshHealth(
    const Slic3r::Model& model,
    const json& args
) {
    return getMeshHealth(model, args);
}

json repairMesh(
    Slic3r::Model& model,
    const json& args
) {
    return repairObject(model, args);
}

} // namespace OrcaWasm
