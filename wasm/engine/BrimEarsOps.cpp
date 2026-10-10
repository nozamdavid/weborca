#include "BrimEarsOps.hpp"
#include "Engine.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/BrimEarsPoint.hpp"

using json = nlohmann::json;

namespace OrcaWasm {

namespace {
Slic3r::ModelObject* find_object(const Slic3r::Model& model, size_t id) {
    for (auto* obj : model.objects) {
        if (obj->id().id == id) return obj;
    }
    return nullptr;
}
}

json getBrimEars(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");

    json points = json::array();
    for (const auto& bp : obj->brim_points) {
        points.push_back({
            {"position", {bp.pos.x(), bp.pos.y(), bp.pos.z()}},
            {"radius", bp.head_front_radius}
        });
    }

    return json{
        {"objectId", object_id},
        {"points", points}
    };
}

json setBrimEars(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");

    auto points_array = args.at("points");
    obj->brim_points.clear();

    for (const auto& pt : points_array) {
        auto pos = pt.at("position");
        float r = pt.value("radius", 5.0f);
        obj->brim_points.push_back(Slic3r::BrimPoint(pos[0].get<float>(), pos[1].get<float>(), pos[2].get<float>(), r));
    }

    return json{{"success", true}};
}

json clearBrimEars(Slic3r::Model& model, const json& args) {
    auto object_id = args.at("objectId").get<size_t>();
    Slic3r::ModelObject* obj = find_object(model, object_id);
    if (!obj) throw Slic3r::RuntimeError("Object not found");

    obj->brim_points.clear();
    return json{{"success", true}};
}

} // namespace OrcaWasm
