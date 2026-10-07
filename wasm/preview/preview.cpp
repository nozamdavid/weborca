#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/html5.h>
#include <glad/gles2.h>

#include "Viewer.hpp"
#include "Types.hpp"
#include "GCodeInputData.hpp"
#include "convert.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"

#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstdio>
#include <cstring>

namespace {

static constexpr float DEG2RAD = 3.14159265358979323846f / 180.0f;

inline libvgcode::Mat4x4 compute_lookat(const libvgcode::Vec3& eye,
                                        const libvgcode::Vec3& target,
                                        const libvgcode::Vec3& up)
{
    float fx = target[0] - eye[0];
    float fy = target[1] - eye[1];
    float fz = target[2] - eye[2];
    float flen = std::sqrt(fx * fx + fy * fy + fz * fz);
    if (flen > 1e-6f) {
        fx /= flen; fy /= flen; fz /= flen;
    }

    // right = cross(f, up)
    float rx = fy * up[2] - fz * up[1];
    float ry = fz * up[0] - fx * up[2];
    float rz = fx * up[1] - fy * up[0];
    float rlen = std::sqrt(rx * rx + ry * ry + rz * rz);
    if (rlen > 1e-6f) {
        rx /= rlen; ry /= rlen; rz /= rlen;
    }

    // true up = cross(r, f)
    float ux = ry * fz - rz * fy;
    float uy = rz * fx - rx * fz;
    float uz = rx * fy - ry * fx;

    libvgcode::Mat4x4 m{};
    // Column 0
    m[0] = rx;
    m[1] = ux;
    m[2] = -fx;
    m[3] = 0.0f;
    // Column 1
    m[4] = ry;
    m[5] = uy;
    m[6] = -fy;
    m[7] = 0.0f;
    // Column 2
    m[8] = rz;
    m[9] = uz;
    m[10] = -fz;
    m[11] = 0.0f;
    // Column 3 (translation)
    m[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
    m[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
    m[14] = (fx * eye[0] + fy * eye[1] + fz * eye[2]);
    m[15] = 1.0f;
    return m;
}

inline libvgcode::Mat4x4 compute_perspective(float fov_rad, float aspect, float near_z, float far_z)
{
    float f = 1.0f / std::tan(fov_rad * 0.5f);
    libvgcode::Mat4x4 m{};
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far_z + near_z) / (near_z - far_z);
    m[11] = -1.0f;
    m[14] = (2.0f * far_z * near_z) / (near_z - far_z);
    m[15] = 0.0f;
    return m;
}

} // namespace

class OrcaPreview {
public:
    OrcaPreview()
        : m_ctx(0)
        , m_width(800)
        , m_height(600)
        , m_target{150.0f, 150.0f, 10.0f}
        , m_distance(50.0f)
        , m_yaw(45.0f)
        , m_pitch(30.0f)
        , m_initialized(false)
    {
    }

    ~OrcaPreview() {
        if (m_initialized) {
            m_viewer.shutdown();
        }
        if (m_ctx > 0) {
            emscripten_webgl_destroy_context(m_ctx);
            m_ctx = 0;
        }
    }

    bool init(const std::string& canvas_selector) {
        if (m_initialized) return true;

        EmscriptenWebGLContextAttributes attrs;
        emscripten_webgl_init_context_attributes(&attrs);
        attrs.majorVersion = 2;
        attrs.minorVersion = 0;
        attrs.explicitSwapControl = 0;
        attrs.depth = 1;
        attrs.stencil = 0;
        attrs.antialias = 1;
        attrs.preserveDrawingBuffer = 1; // Preserve buffer for screenshot and test verification
        attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_DEFAULT;

        EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_create_context(canvas_selector.c_str(), &attrs);
        if (ctx <= 0 && canvas_selector.rfind("#", 0) != 0) {
            std::string prefixed = "#" + canvas_selector;
            ctx = emscripten_webgl_create_context(prefixed.c_str(), &attrs);
        }
        if (ctx <= 0) {
            std::fprintf(stderr, "OrcaPreview: Failed to create WebGL2 context for target '%s'\n", canvas_selector.c_str());
            return false;
        }

        EMSCRIPTEN_RESULT res = emscripten_webgl_make_context_current(ctx);
        if (res != EMSCRIPTEN_RESULT_SUCCESS) {
            std::fprintf(stderr, "OrcaPreview: Failed to make WebGL context current (%d)\n", res);
            emscripten_webgl_destroy_context(ctx);
            return false;
        }

        m_ctx = ctx;

        // Initialize libvgcode Viewer with OpenGL ES 3.0 context
        // Viewer::init calls OpenGLWrapper::load_opengl which invokes gladLoaderLoadGLES2()
        try {
            m_viewer.init("OpenGL ES 3.0");
        } catch (const std::exception& e) {
            std::fprintf(stderr, "OrcaPreview: Viewer::init failed: %s\n", e.what());
            return false;
        }

        // Default viewport setup (now gladLoaderLoadGLES2 has populated GL function pointers)
        glViewport(0, 0, m_width, m_height);

        m_initialized = true;
        std::printf("OrcaPreview: Initialized WebGL2 context on %s\n", canvas_selector.c_str());
        return true;
    }

    std::string loadGcode(const std::string& path) {
        if (!m_initialized) {
            std::fprintf(stderr, "OrcaPreview: Must call init() before loadGcode()\n");
            return "{\"error\":\"Not initialized\"}";
        }

        emscripten_webgl_make_context_current(m_ctx);

        Slic3r::GCodeProcessor processor;
        try {
            processor.process_file(path);
        } catch (const std::exception& e) {
            std::fprintf(stderr, "OrcaPreview: GCodeProcessor::process_file failed on '%s': %s\n", path.c_str(), e.what());
            char err[512];
            std::snprintf(err, sizeof(err), "{\"error\":\"%s\"}", e.what());
            return std::string(err);
        }

        const Slic3r::GCodeProcessorResult& res = processor.get_result();

        std::vector<std::string> tool_colors = res.extruder_colors;
        if (tool_colors.empty()) {
            tool_colors.push_back("#009688");
        }
        std::vector<std::string> cp_colors;

        libvgcode::GCodeInputData data = libvgcode::convert(res, tool_colors, cp_colors, m_viewer);

        m_viewer.reset_default_extrusion_roles_colors();
        m_viewer.load(std::move(data));

        // Center camera specifically on extrusion bounds (avoiding travel moves from origin)
        libvgcode::AABox bbox = m_viewer.get_bounding_box({ libvgcode::EMoveType::Extrude });
        if (bbox[0][0] > bbox[1][0]) {
            bbox = m_viewer.get_bounding_box();
        }

        m_target = {
            (bbox[0][0] + bbox[1][0]) * 0.5f,
            (bbox[0][1] + bbox[1][1]) * 0.5f,
            (bbox[0][2] + bbox[1][2]) * 0.5f
        };
        float dx = bbox[1][0] - bbox[0][0];
        float dy = bbox[1][1] - bbox[0][1];
        float dz = bbox[1][2] - bbox[0][2];
        float radius = std::sqrt(dx * dx + dy * dy + dz * dz) * 0.5f;
        m_distance = std::max(radius * 2.5f, 25.0f);
        m_yaw = 45.0f;
        m_pitch = 30.0f;

        size_t layers_count = m_viewer.get_layers_count();
        size_t moves_count = m_viewer.get_vertices_count();
        float time_s = processor.get_time(Slic3r::PrintEstimatedStatistics::ETimeMode::Normal);
        if (time_s <= 0.0f) {
            time_s = m_viewer.get_estimated_time();
        }

        char buf[256];
        std::snprintf(buf, sizeof(buf), "{\"layers\":%zu,\"moves\":%zu,\"timeS\":%.2f}",
                      layers_count, moves_count, time_s);
        return std::string(buf);
    }

    void setLayerRange(int min_layer, int max_layer) {
        if (!m_initialized || m_viewer.get_layers_count() == 0) return;
        size_t count = m_viewer.get_layers_count();
        size_t cl_min = std::clamp<size_t>(min_layer, 0, count - 1);
        size_t cl_max = std::clamp<size_t>(max_layer, cl_min, count - 1);
        m_viewer.set_layers_view_range(cl_min, cl_max);
    }

    void setViewType(const std::string& name) {
        if (!m_initialized) return;

        std::string s = name;
        std::transform(s.begin(), s.end(), s.begin(), ::tolower);
        s.erase(std::remove_if(s.begin(), s.end(), [](char c) {
            return c == ' ' || c == '_' || c == '-';
        }), s.end());

        if (s == "featuretype" || s == "feature") {
            m_viewer.set_view_type(libvgcode::EViewType::FeatureType);
        } else if (s == "speed") {
            m_viewer.set_view_type(libvgcode::EViewType::Speed);
        } else if (s == "actualspeed") {
            m_viewer.set_view_type(libvgcode::EViewType::ActualSpeed);
        } else if (s == "height") {
            m_viewer.set_view_type(libvgcode::EViewType::Height);
        } else if (s == "width") {
            m_viewer.set_view_type(libvgcode::EViewType::Width);
        } else if (s == "tool") {
            m_viewer.set_view_type(libvgcode::EViewType::Tool);
        } else if (s == "colorprint") {
            m_viewer.set_view_type(libvgcode::EViewType::ColorPrint);
        } else if (s == "volumetricflowrate" || s == "volumetric" || s == "flow") {
            m_viewer.set_view_type(libvgcode::EViewType::VolumetricFlowRate);
        } else if (s == "fanspeed" || s == "fan") {
            m_viewer.set_view_type(libvgcode::EViewType::FanSpeed);
        } else if (s == "temperature" || s == "temp") {
            m_viewer.set_view_type(libvgcode::EViewType::Temperature);
        } else if (s == "pressureadvance" || s == "pa") {
            m_viewer.set_view_type(libvgcode::EViewType::PressureAdvance);
        } else if (s == "acceleration" || s == "accel") {
            m_viewer.set_view_type(libvgcode::EViewType::Acceleration);
        } else if (s == "jerk") {
            m_viewer.set_view_type(libvgcode::EViewType::Jerk);
        } else if (s == "layertime" || s == "time") {
            m_viewer.set_view_type(libvgcode::EViewType::LayerTimeLinear);
        } else if (s == "summary") {
            m_viewer.set_view_type(libvgcode::EViewType::Summary);
        } else {
            std::printf("OrcaPreview: Unknown view type '%s', default to FeatureType\n", name.c_str());
            m_viewer.set_view_type(libvgcode::EViewType::FeatureType);
        }
    }

    void resize(int w, int h) {
        m_width = (w > 0) ? w : 1;
        m_height = (h > 0) ? h : 1;
        if (m_ctx > 0 && m_initialized) {
            emscripten_webgl_make_context_current(m_ctx);
            glViewport(0, 0, m_width, m_height);
        }
    }

    void orbit(float dx, float dy) {
        m_yaw += dx * 0.5f;
        m_pitch = std::clamp(m_pitch + dy * 0.5f, -89.0f, 89.0f);
    }

    void pan(float dx, float dy) {
        float p_rad = m_pitch * DEG2RAD;
        float y_rad = m_yaw * DEG2RAD;

        libvgcode::Vec3 eye = {
            m_target[0] + m_distance * std::cos(p_rad) * std::sin(y_rad),
            m_target[1] - m_distance * std::cos(p_rad) * std::cos(y_rad),
            m_target[2] + m_distance * std::sin(p_rad)
        };
        float fx = m_target[0] - eye[0];
        float fy = m_target[1] - eye[1];
        float fz = m_target[2] - eye[2];
        float flen = std::sqrt(fx * fx + fy * fy + fz * fz);
        if (flen > 1e-6f) { fx /= flen; fy /= flen; fz /= flen; }

        float rx = fy;
        float ry = -fx;
        float rlen = std::sqrt(rx * rx + ry * ry);
        if (rlen > 1e-6f) { rx /= rlen; ry /= rlen; }

        float ux = ry * fz;
        float uy = -rx * fz;
        float uz = rx * fy - ry * fx;

        float scale = m_distance * 0.002f;
        m_target[0] -= (rx * dx - ux * dy) * scale;
        m_target[1] -= (ry * dx - uy * dy) * scale;
        m_target[2] -= (-uz * dy) * scale;
    }

    void zoom(float delta) {
        m_distance = std::max(5.0f, m_distance * (1.0f + delta * 0.001f));
    }

    void resetCamera() {
        if (!m_initialized) return;
        libvgcode::AABox bbox = m_viewer.get_bounding_box({ libvgcode::EMoveType::Extrude });
        if (bbox[0][0] > bbox[1][0]) {
            bbox = m_viewer.get_bounding_box();
        }
        m_target = {
            (bbox[0][0] + bbox[1][0]) * 0.5f,
            (bbox[0][1] + bbox[1][1]) * 0.5f,
            (bbox[0][2] + bbox[1][2]) * 0.5f
        };
        float dx = bbox[1][0] - bbox[0][0];
        float dy = bbox[1][1] - bbox[0][1];
        float dz = bbox[1][2] - bbox[0][2];
        float radius = std::sqrt(dx * dx + dy * dy + dz * dz) * 0.5f;
        m_distance = std::max(radius * 2.5f, 25.0f);
        m_yaw = 45.0f;
        m_pitch = 30.0f;
    }

    void render() {
        if (!m_initialized) return;

        float pitch_rad = m_pitch * DEG2RAD;
        float yaw_rad = m_yaw * DEG2RAD;
        libvgcode::Vec3 eye = {
            m_target[0] + m_distance * std::cos(pitch_rad) * std::sin(yaw_rad),
            m_target[1] - m_distance * std::cos(pitch_rad) * std::cos(yaw_rad),
            m_target[2] + m_distance * std::sin(pitch_rad)
        };

        libvgcode::Mat4x4 view = compute_lookat(eye, m_target, {0.0f, 0.0f, 1.0f});
        float aspect = (m_height > 0) ? (static_cast<float>(m_width) / static_cast<float>(m_height)) : 1.0f;
        float near_z = std::max(0.1f, m_distance * 0.01f);
        float far_z = std::max(100.0f, m_distance * 10.0f);
        libvgcode::Mat4x4 proj = compute_perspective(45.0f * DEG2RAD, aspect, near_z, far_z);

        do_render(view, proj);
    }

    void renderMatrices(emscripten::val viewArr, emscripten::val projArr) {
        if (!m_initialized) return;

        libvgcode::Mat4x4 view;
        libvgcode::Mat4x4 proj;
        for (int i = 0; i < 16; ++i) {
            view[i] = viewArr[i].as<float>();
            proj[i] = projArr[i].as<float>();
        }

        do_render(view, proj);
    }

    size_t getLayersCount() const { return m_viewer.get_layers_count(); }
    size_t getMovesCount() const { return m_viewer.get_vertices_count(); }
    float getEstimatedTime() const { return m_viewer.get_estimated_time(); }

private:
    void do_render(const libvgcode::Mat4x4& view, const libvgcode::Mat4x4& proj) {
        emscripten_webgl_make_context_current(m_ctx);

        glViewport(0, 0, m_width, m_height);
        glClearColor(0.13f, 0.14f, 0.16f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        glEnable(GL_DEPTH_TEST);
        glDepthFunc(GL_LEQUAL);

        m_viewer.render(view, proj);
    }

    libvgcode::Viewer m_viewer;
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE m_ctx;
    int m_width;
    int m_height;
    libvgcode::Vec3 m_target;
    float m_distance;
    float m_yaw;
    float m_pitch;
    bool m_initialized;
};

EMSCRIPTEN_BINDINGS(orca_preview) {
    emscripten::class_<OrcaPreview>("OrcaPreview")
        .constructor<>()
        .function("init", &OrcaPreview::init)
        .function("loadGcode", &OrcaPreview::loadGcode)
        .function("setLayerRange", &OrcaPreview::setLayerRange)
        .function("setViewType", &OrcaPreview::setViewType)
        .function("resize", &OrcaPreview::resize)
        .function("render", &OrcaPreview::render)
        .function("renderMatrices", &OrcaPreview::renderMatrices)
        .function("orbit", &OrcaPreview::orbit)
        .function("pan", &OrcaPreview::pan)
        .function("zoom", &OrcaPreview::zoom)
        .function("resetCamera", &OrcaPreview::resetCamera)
        .function("getLayersCount", &OrcaPreview::getLayersCount)
        .function("getMovesCount", &OrcaPreview::getMovesCount)
        .function("getEstimatedTime", &OrcaPreview::getEstimatedTime)
        ;
}

int main() {
    return 0;
}
