#include "PaintOps.hpp"

#include "libslic3r/Model.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/TriangleSelector.hpp"
#include "libslic3r/Utils.hpp"

#include <memory>
#include <string>
#include <vector>
#include <utility>

using json = nlohmann::json;

namespace OrcaWasm {

namespace {

Slic3r::ModelObject* find_object(Slic3r::Model& model, size_t object_id) {
    for (auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

const Slic3r::ModelObject* find_object(const Slic3r::Model& model, size_t object_id) {
    for (const auto* obj : model.objects) {
        if (obj && obj->id().id == object_id)
            return obj;
    }
    return nullptr;
}

template <typename VolPtr, typename ObjPtr>
VolPtr find_volume_impl(ObjPtr obj, const json& args) {
    if (!obj) return nullptr;
    if (args.contains("volumeId") && !args["volumeId"].is_null()) {
        if (!args["volumeId"].is_number_integer() && !args["volumeId"].is_number_unsigned()) {
            throw Slic3r::RuntimeError("volumeId must be an integer");
        }
        size_t vol_id = args["volumeId"].get<size_t>();
        for (auto* vol : obj->volumes) {
            if (vol && vol->id().id == vol_id)
                return vol;
        }
        return nullptr;
    }
    if (args.contains("volumeIndex") && !args["volumeIndex"].is_null()) {
        if (!args["volumeIndex"].is_number_integer()) {
            throw Slic3r::RuntimeError("volumeIndex must be an integer");
        }
        int idx = args["volumeIndex"].get<int>();
        if (idx >= 0 && idx < static_cast<int>(obj->volumes.size()))
            return obj->volumes[idx];
        return nullptr;
    }
    VolPtr part_vol = nullptr;
    int part_count = 0;
    for (auto* vol : obj->volumes) {
        if (vol && vol->is_model_part()) {
            part_vol = vol;
            part_count++;
        }
    }
    if (part_count == 1)
        return part_vol;
    if (obj->volumes.size() == 1)
        return obj->volumes[0];
    return nullptr;
}

Slic3r::ModelVolume* find_volume(Slic3r::ModelObject* obj, const json& args) {
    return find_volume_impl<Slic3r::ModelVolume*, Slic3r::ModelObject*>(obj, args);
}

const Slic3r::ModelVolume* find_volume(const Slic3r::ModelObject* obj, const json& args) {
    return find_volume_impl<const Slic3r::ModelVolume*, const Slic3r::ModelObject*>(obj, args);
}

class SupportTriangleSelector : public Slic3r::TriangleSelector {
public:
    explicit SupportTriangleSelector(const Slic3r::TriangleMesh& mesh)
        : Slic3r::TriangleSelector(mesh) {}

    int original_triangle_count() const {
        return m_orig_size_indices;
    }

    Slic3r::EnforcerBlockerType get_facet_state(int facet_idx) const {
        if (facet_idx < 0 || facet_idx >= m_orig_size_indices)
            return Slic3r::EnforcerBlockerType::NONE;
        const Triangle& tr = m_triangles[facet_idx];
        if (!tr.valid())
            return Slic3r::EnforcerBlockerType::NONE;
        return get_leaf_state(tr);
    }

private:
    Slic3r::EnforcerBlockerType get_leaf_state(const Triangle& tr) const {
        if (!tr.is_split()) {
            return tr.get_state();
        }
        for (int i = 0; i <= tr.number_of_split_sides(); ++i) {
            Slic3r::EnforcerBlockerType s = get_leaf_state(m_triangles[tr.children[i]]);
            if (s != Slic3r::EnforcerBlockerType::NONE)
                return s;
        }
        return Slic3r::EnforcerBlockerType::NONE;
    }
};

std::string state_to_string(Slic3r::EnforcerBlockerType state) {
    switch (state) {
    case Slic3r::EnforcerBlockerType::ENFORCER:
        return "enforcer";
    case Slic3r::EnforcerBlockerType::BLOCKER:
        return "blocker";
    default:
        return "none";
    }
}

bool parse_state(const json& state_val, Slic3r::EnforcerBlockerType& out_state) {
    if (state_val.is_number_integer()) {
        int v = state_val.get<int>();
        if (v == 0) {
            out_state = Slic3r::EnforcerBlockerType::NONE;
            return true;
        } else if (v == 1) {
            out_state = Slic3r::EnforcerBlockerType::ENFORCER;
            return true;
        } else if (v == 2) {
            out_state = Slic3r::EnforcerBlockerType::BLOCKER;
            return true;
        }
        return false;
    } else if (state_val.is_string()) {
        std::string s = state_val.get<std::string>();
        if (s == "none" || s == "clear" || s == "neutral" || s == "reset" || s == "0") {
            out_state = Slic3r::EnforcerBlockerType::NONE;
            return true;
        } else if (s == "enforcer" || s == "support_enforcer" || s == "seam_enforcer" || s == "1") {
            out_state = Slic3r::EnforcerBlockerType::ENFORCER;
            return true;
        } else if (s == "blocker" || s == "support_blocker" || s == "seam_blocker" || s == "2") {
            out_state = Slic3r::EnforcerBlockerType::BLOCKER;
            return true;
        }
        return false;
    }
    return false;
}

} // namespace

json getSupportPainting(const Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("getSupportPainting requires objectId");
    }
    if (!args["objectId"].is_number_integer() && !args["objectId"].is_number_unsigned()) {
        throw Slic3r::RuntimeError("objectId must be an integer");
    }
    size_t object_id = args["objectId"].get<size_t>();
    const Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    const Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Volume is not a model part");
    }

    const Slic3r::TriangleMesh& mesh = vol->mesh();
    int total_triangles = static_cast<int>(mesh.its.indices.size());

    // Strict validation of facetIds if provided
    std::vector<int> queried_ids;
    if (args.contains("facetIds")) {
        if (!args["facetIds"].is_array()) {
            throw Slic3r::RuntimeError("Field 'facetIds' must be an array");
        }
        for (const auto& item : args["facetIds"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'facetIds' array must be integers");
            }
            int fid = item.get<int>();
            if (fid < 0 || fid >= total_triangles) {
                throw Slic3r::RuntimeError(
                    "Invalid facet index " + std::to_string(fid) +
                    "; mesh has " + std::to_string(total_triangles) + " facets"
                );
            }
            queried_ids.push_back(fid);
        }
    }

    bool has_custom_supports = !vol->supported_facets.empty();
    std::vector<int> enforcers;
    std::vector<int> blockers;
    json facets_arr = json::array();

    std::unique_ptr<SupportTriangleSelector> selector;
    if (has_custom_supports || !queried_ids.empty()) {
        selector = std::make_unique<SupportTriangleSelector>(mesh);
        if (has_custom_supports) {
            selector->deserialize(vol->supported_facets.get_data(), false);
        }
    }

    if (has_custom_supports && selector) {
        for (int i = 0; i < total_triangles; ++i) {
            Slic3r::EnforcerBlockerType st = selector->get_facet_state(i);
            if (st == Slic3r::EnforcerBlockerType::ENFORCER) {
                enforcers.push_back(i);
                facets_arr.push_back({
                    {"facetId", i},
                    {"state", "enforcer"},
                    {"type", 1}
                });
            } else if (st == Slic3r::EnforcerBlockerType::BLOCKER) {
                blockers.push_back(i);
                facets_arr.push_back({
                    {"facetId", i},
                    {"state", "blocker"},
                    {"type", 2}
                });
            }
        }
    }

    json result = {
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"triangleCount", total_triangles},
        {"hasCustomSupports", has_custom_supports},
        {"enforcers", enforcers},
        {"blockers", blockers},
        {"facets", facets_arr},
        {"statistics", {
            {"enforcersCount", enforcers.size()},
            {"blockersCount", blockers.size()},
            {"totalPainted", enforcers.size() + blockers.size()}
        }}
    };

    if (args.contains("facetIds")) {
        json queried_facets = json::array();
        for (int fid : queried_ids) {
            Slic3r::EnforcerBlockerType st = selector ? selector->get_facet_state(fid) : Slic3r::EnforcerBlockerType::NONE;
            queried_facets.push_back({
                {"facetId", fid},
                {"state", state_to_string(st)},
                {"type", static_cast<int>(st)}
            });
        }
        result["queriedFacets"] = queried_facets;
    }

    return result;
}

json setSupportPainting(Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("setSupportPainting requires objectId");
    }
    if (!args["objectId"].is_number_integer() && !args["objectId"].is_number_unsigned()) {
        throw Slic3r::RuntimeError("objectId must be an integer");
    }
    size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Cannot paint support on non-model-part volume");
    }

    const Slic3r::TriangleMesh& mesh = vol->mesh();
    int total_triangles = static_cast<int>(mesh.its.indices.size());

    bool reset_first = false;
    if (args.contains("reset") && args["reset"].is_boolean() && args["reset"].get<bool>()) {
        reset_first = true;
    }

    std::vector<std::pair<int, Slic3r::EnforcerBlockerType>> updates;

    // Helper lambda to validate and stage facet updates
    auto stage_update = [&](int facet_id, const json& state_val) {
        if (facet_id < 0 || facet_id >= total_triangles) {
            throw Slic3r::RuntimeError(
                "Invalid facet index " + std::to_string(facet_id) +
                "; mesh has " + std::to_string(total_triangles) + " facets"
            );
        }
        Slic3r::EnforcerBlockerType st = Slic3r::EnforcerBlockerType::NONE;
        if (!parse_state(state_val, st)) {
            std::string s_repr = state_val.is_string() ? state_val.get<std::string>() : state_val.dump();
            throw Slic3r::RuntimeError("Invalid support painting state: " + s_repr);
        }
        updates.emplace_back(facet_id, st);
    };

    // 1. Check "facets" array: [{ facetId: ..., state: ... }, ...] or [[facetId, state], ...]
    if (args.contains("facets")) {
        if (!args["facets"].is_array()) {
            throw Slic3r::RuntimeError("Field 'facets' must be an array");
        }
        for (const auto& item : args["facets"]) {
            if (item.is_object()) {
                int fid = -1;
                if (item.contains("facetId") && item["facetId"].is_number_integer()) {
                    fid = item["facetId"].get<int>();
                } else if (item.contains("id") && item["id"].is_number_integer()) {
                    fid = item["id"].get<int>();
                } else {
                    throw Slic3r::RuntimeError("Each facet item must contain an integer 'facetId'");
                }
                if (!item.contains("state")) {
                    throw Slic3r::RuntimeError("Each facet item must contain a 'state'");
                }
                stage_update(fid, item["state"]);
            } else if (item.is_array() && item.size() >= 2) {
                if (!item[0].is_number_integer()) {
                    throw Slic3r::RuntimeError("Facet array entry must start with an integer facetId");
                }
                stage_update(item[0].get<int>(), item[1]);
            } else {
                throw Slic3r::RuntimeError("Invalid facet entry in 'facets' array");
            }
        }
    }

    // 2. Convenience lists: "enforcers", "blockers", "clear"
    if (args.contains("enforcers")) {
        if (!args["enforcers"].is_array()) {
            throw Slic3r::RuntimeError("Field 'enforcers' must be an array");
        }
        for (const auto& item : args["enforcers"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'enforcers' array must be integers");
            }
            stage_update(item.get<int>(), json(1));
        }
    }
    if (args.contains("blockers")) {
        if (!args["blockers"].is_array()) {
            throw Slic3r::RuntimeError("Field 'blockers' must be an array");
        }
        for (const auto& item : args["blockers"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'blockers' array must be integers");
            }
            stage_update(item.get<int>(), json(2));
        }
    }
    if (args.contains("clear")) {
        if (!args["clear"].is_array()) {
            throw Slic3r::RuntimeError("Field 'clear' must be an array");
        }
        for (const auto& item : args["clear"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'clear' array must be integers");
            }
            stage_update(item.get<int>(), json(0));
        }
    }

    // 3. Single facet shorthand: "facetId" + "state"
    if (args.contains("facetId")) {
        if (!args["facetId"].is_number_integer()) {
            throw Slic3r::RuntimeError("Single 'facetId' must be an integer");
        }
        if (!args.contains("state")) {
            throw Slic3r::RuntimeError("Single facet update requires 'state'");
        }
        stage_update(args["facetId"].get<int>(), args["state"]);
    }

    if (updates.empty() && !reset_first) {
        throw Slic3r::RuntimeError("No facet updates or reset specified");
    }

    // All validation passed without error. Now perform the mutation atomically.
    if (reset_first) {
        vol->supported_facets.reset();
    }

    if (!updates.empty()) {
        Slic3r::TriangleSelector selector(vol->mesh());
        if (!vol->supported_facets.empty()) {
            selector.deserialize(vol->supported_facets.get_data(), false);
        }
        for (const auto& [fid, st] : updates) {
            selector.set_facet(fid, st);
        }
        vol->supported_facets.set(selector);
    }

    int enforcers_count = 0;
    int blockers_count = 0;
    if (!vol->supported_facets.empty()) {
        SupportTriangleSelector count_selector(vol->mesh());
        count_selector.deserialize(vol->supported_facets.get_data(), false);
        for (int i = 0; i < total_triangles; ++i) {
            auto s = count_selector.get_facet_state(i);
            if (s == Slic3r::EnforcerBlockerType::ENFORCER) enforcers_count++;
            else if (s == Slic3r::EnforcerBlockerType::BLOCKER) blockers_count++;
        }
    }

    return json{
        {"updated", true},
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"triangleCount", total_triangles},
        {"enforcersCount", enforcers_count},
        {"blockersCount", blockers_count},
        {"modifiedCount", updates.size()}
    };
}

json clearSupportPainting(Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("clearSupportPainting requires objectId");
    }
    if (!args["objectId"].is_number_integer() && !args["objectId"].is_number_unsigned()) {
        throw Slic3r::RuntimeError("objectId must be an integer");
    }
    size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Volume is not a model part");
    }

    vol->supported_facets.reset();
    return json{
        {"cleared", true},
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id}
    };
}

json getSeamPainting(const Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("getSeamPainting requires objectId");
    }
    if (!args["objectId"].is_number_integer() && !args["objectId"].is_number_unsigned()) {
        throw Slic3r::RuntimeError("objectId must be an integer");
    }
    size_t object_id = args["objectId"].get<size_t>();
    const Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    const Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Volume is not a model part");
    }

    const Slic3r::TriangleMesh& mesh = vol->mesh();
    int total_triangles = static_cast<int>(mesh.its.indices.size());

    // Strict validation of facetIds if provided
    std::vector<int> queried_ids;
    if (args.contains("facetIds")) {
        if (!args["facetIds"].is_array()) {
            throw Slic3r::RuntimeError("Field 'facetIds' must be an array");
        }
        for (const auto& item : args["facetIds"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'facetIds' array must be integers");
            }
            int fid = item.get<int>();
            if (fid < 0 || fid >= total_triangles) {
                throw Slic3r::RuntimeError(
                    "Invalid facet index " + std::to_string(fid) +
                    "; mesh has " + std::to_string(total_triangles) + " facets"
                );
            }
            queried_ids.push_back(fid);
        }
    }

    bool has_custom_seam = !vol->seam_facets.empty();
    std::vector<int> enforcers;
    std::vector<int> blockers;
    json facets_arr = json::array();

    std::unique_ptr<SupportTriangleSelector> selector;
    if (has_custom_seam || !queried_ids.empty()) {
        selector = std::make_unique<SupportTriangleSelector>(mesh);
        if (has_custom_seam) {
            selector->deserialize(vol->seam_facets.get_data(), false);
        }
    }

    if (has_custom_seam && selector) {
        for (int i = 0; i < total_triangles; ++i) {
            Slic3r::EnforcerBlockerType st = selector->get_facet_state(i);
            if (st == Slic3r::EnforcerBlockerType::ENFORCER) {
                enforcers.push_back(i);
                facets_arr.push_back({
                    {"facetId", i},
                    {"state", "enforcer"},
                    {"type", 1}
                });
            } else if (st == Slic3r::EnforcerBlockerType::BLOCKER) {
                blockers.push_back(i);
                facets_arr.push_back({
                    {"facetId", i},
                    {"state", "blocker"},
                    {"type", 2}
                });
            }
        }
    }

    json result = {
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"triangleCount", total_triangles},
        {"hasCustomSeam", has_custom_seam},
        {"hasCustomSeams", has_custom_seam},
        {"enforcers", enforcers},
        {"blockers", blockers},
        {"facets", facets_arr},
        {"statistics", {
            {"enforcersCount", enforcers.size()},
            {"blockersCount", blockers.size()},
            {"totalPainted", enforcers.size() + blockers.size()}
        }}
    };

    if (args.contains("facetIds")) {
        json queried_facets = json::array();
        for (int fid : queried_ids) {
            Slic3r::EnforcerBlockerType st = selector ? selector->get_facet_state(fid) : Slic3r::EnforcerBlockerType::NONE;
            queried_facets.push_back({
                {"facetId", fid},
                {"state", state_to_string(st)},
                {"type", static_cast<int>(st)}
            });
        }
        result["queriedFacets"] = queried_facets;
    }

    return result;
}

json setSeamPainting(Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("setSeamPainting requires objectId");
    }
    if (!args["objectId"].is_number_integer() && !args["objectId"].is_number_unsigned()) {
        throw Slic3r::RuntimeError("objectId must be an integer");
    }
    size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Cannot paint seam on non-model-part volume");
    }

    const Slic3r::TriangleMesh& mesh = vol->mesh();
    int total_triangles = static_cast<int>(mesh.its.indices.size());

    bool reset_first = false;
    if (args.contains("reset") && args["reset"].is_boolean() && args["reset"].get<bool>()) {
        reset_first = true;
    }

    std::vector<std::pair<int, Slic3r::EnforcerBlockerType>> updates;

    // Helper lambda to validate and stage facet updates
    auto stage_update = [&](int facet_id, const json& state_val) {
        if (facet_id < 0 || facet_id >= total_triangles) {
            throw Slic3r::RuntimeError(
                "Invalid facet index " + std::to_string(facet_id) +
                "; mesh has " + std::to_string(total_triangles) + " facets"
            );
        }
        Slic3r::EnforcerBlockerType st = Slic3r::EnforcerBlockerType::NONE;
        if (!parse_state(state_val, st)) {
            std::string s_repr = state_val.is_string() ? state_val.get<std::string>() : state_val.dump();
            throw Slic3r::RuntimeError("Invalid seam painting state: " + s_repr);
        }
        updates.emplace_back(facet_id, st);
    };

    // 1. Check "facets" array: [{ facetId: ..., state: ... }, ...] or [[facetId, state], ...]
    if (args.contains("facets")) {
        if (!args["facets"].is_array()) {
            throw Slic3r::RuntimeError("Field 'facets' must be an array");
        }
        for (const auto& item : args["facets"]) {
            if (item.is_object()) {
                int fid = -1;
                if (item.contains("facetId") && item["facetId"].is_number_integer()) {
                    fid = item["facetId"].get<int>();
                } else if (item.contains("id") && item["id"].is_number_integer()) {
                    fid = item["id"].get<int>();
                } else {
                    throw Slic3r::RuntimeError("Each facet item must contain an integer 'facetId'");
                }
                if (!item.contains("state")) {
                    throw Slic3r::RuntimeError("Each facet item must contain a 'state'");
                }
                stage_update(fid, item["state"]);
            } else if (item.is_array() && item.size() >= 2) {
                if (!item[0].is_number_integer()) {
                    throw Slic3r::RuntimeError("Facet array entry must start with an integer facetId");
                }
                stage_update(item[0].get<int>(), item[1]);
            } else {
                throw Slic3r::RuntimeError("Invalid facet entry in 'facets' array");
            }
        }
    }

    // 2. Convenience lists: "enforcers", "blockers", "clear"
    if (args.contains("enforcers")) {
        if (!args["enforcers"].is_array()) {
            throw Slic3r::RuntimeError("Field 'enforcers' must be an array");
        }
        for (const auto& item : args["enforcers"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'enforcers' array must be integers");
            }
            stage_update(item.get<int>(), json(1));
        }
    }
    if (args.contains("blockers")) {
        if (!args["blockers"].is_array()) {
            throw Slic3r::RuntimeError("Field 'blockers' must be an array");
        }
        for (const auto& item : args["blockers"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'blockers' array must be integers");
            }
            stage_update(item.get<int>(), json(2));
        }
    }
    if (args.contains("clear")) {
        if (!args["clear"].is_array()) {
            throw Slic3r::RuntimeError("Field 'clear' must be an array");
        }
        for (const auto& item : args["clear"]) {
            if (!item.is_number_integer()) {
                throw Slic3r::RuntimeError("Items in 'clear' array must be integers");
            }
            stage_update(item.get<int>(), json(0));
        }
    }

    // 3. Single facet shorthand: "facetId" + "state"
    if (args.contains("facetId")) {
        if (!args["facetId"].is_number_integer()) {
            throw Slic3r::RuntimeError("Single 'facetId' must be an integer");
        }
        if (!args.contains("state")) {
            throw Slic3r::RuntimeError("Single facet update requires 'state'");
        }
        stage_update(args["facetId"].get<int>(), args["state"]);
    }

    if (updates.empty() && !reset_first) {
        throw Slic3r::RuntimeError("No facet updates or reset specified");
    }

    // All validation passed without error. Now perform the mutation atomically.
    if (reset_first) {
        vol->seam_facets.reset();
    }

    if (!updates.empty()) {
        Slic3r::TriangleSelector selector(vol->mesh());
        if (!vol->seam_facets.empty()) {
            selector.deserialize(vol->seam_facets.get_data(), false);
        }
        for (const auto& [fid, st] : updates) {
            selector.set_facet(fid, st);
        }
        vol->seam_facets.set(selector);
    }

    int enforcers_count = 0;
    int blockers_count = 0;
    if (!vol->seam_facets.empty()) {
        SupportTriangleSelector count_selector(vol->mesh());
        count_selector.deserialize(vol->seam_facets.get_data(), false);
        for (int i = 0; i < total_triangles; ++i) {
            auto s = count_selector.get_facet_state(i);
            if (s == Slic3r::EnforcerBlockerType::ENFORCER) enforcers_count++;
            else if (s == Slic3r::EnforcerBlockerType::BLOCKER) blockers_count++;
        }
    }

    return json{
        {"updated", true},
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id},
        {"triangleCount", total_triangles},
        {"enforcersCount", enforcers_count},
        {"blockersCount", blockers_count},
        {"modifiedCount", updates.size()}
    };
}

json clearSeamPainting(Slic3r::Model& model, const json& args) {
    if (!args.contains("objectId")) {
        throw Slic3r::RuntimeError("clearSeamPainting requires objectId");
    }
    if (!args["objectId"].is_number_integer() && !args["objectId"].is_number_unsigned()) {
        throw Slic3r::RuntimeError("objectId must be an integer");
    }
    size_t object_id = args["objectId"].get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) {
        throw Slic3r::RuntimeError("Object not found: " + std::to_string(object_id));
    }
    Slic3r::ModelVolume* vol = find_volume(obj, args);
    if (!vol) {
        throw Slic3r::RuntimeError("Volume not found on object: " + std::to_string(object_id));
    }
    if (!vol->is_model_part()) {
        throw Slic3r::RuntimeError("Volume is not a model part");
    }

    vol->seam_facets.reset();
    return json{
        {"cleared", true},
        {"objectId", obj->id().id},
        {"volumeId", vol->id().id}
    };
}

} // namespace OrcaWasm
