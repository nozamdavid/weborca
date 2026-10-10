#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/html5.h>
#include <glad/gles2.h>

#include "Viewer.hpp"
#include "Types.hpp"
#include "ColorRange.hpp"
#include "GCodeInputData.hpp"
#include "convert.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"

#include <string>
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <iomanip>

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

inline libvgcode::Mat4x4 multiply_mat4(const libvgcode::Mat4x4& a, const libvgcode::Mat4x4& b)
{
    libvgcode::Mat4x4 r{};
    for (int col = 0; col < 4; ++col) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k) {
                sum += a[k * 4 + row] * b[col * 4 + k];
            }
            r[col * 4 + row] = sum;
        }
    }
    return r;
}

inline std::string to_hex(const libvgcode::Color& c) {
    char buf[10];
    std::snprintf(buf, sizeof(buf), "#%02x%02x%02x", c[0], c[1], c[2]);
    return std::string(buf);
}

inline const char* role_name(libvgcode::EGCodeExtrusionRole role) {
    switch (role) {
    case libvgcode::EGCodeExtrusionRole::Perimeter: return "Inner wall";
    case libvgcode::EGCodeExtrusionRole::ExternalPerimeter: return "Outer wall";
    case libvgcode::EGCodeExtrusionRole::OverhangPerimeter: return "Overhang wall";
    case libvgcode::EGCodeExtrusionRole::InternalInfill: return "Internal infill";
    case libvgcode::EGCodeExtrusionRole::SolidInfill: return "Solid infill";
    case libvgcode::EGCodeExtrusionRole::TopSolidInfill: return "Top surface";
    case libvgcode::EGCodeExtrusionRole::Ironing: return "Ironing";
    case libvgcode::EGCodeExtrusionRole::BridgeInfill: return "Bridge";
    case libvgcode::EGCodeExtrusionRole::GapFill: return "Gap infill";
    case libvgcode::EGCodeExtrusionRole::Skirt: return "Skirt";
    case libvgcode::EGCodeExtrusionRole::SupportMaterial: return "Support";
    case libvgcode::EGCodeExtrusionRole::SupportMaterialInterface: return "Support interface";
    case libvgcode::EGCodeExtrusionRole::WipeTower: return "Wipe tower";
    case libvgcode::EGCodeExtrusionRole::BottomSurface: return "Bottom surface";
    case libvgcode::EGCodeExtrusionRole::InternalBridgeInfill: return "Internal bridge";
    case libvgcode::EGCodeExtrusionRole::Brim: return "Brim";
    case libvgcode::EGCodeExtrusionRole::SupportTransition: return "Support transition";
    default: return "Custom";
    }
}

inline const char* option_name(libvgcode::EOptionType opt) {
    switch (opt) {
    case libvgcode::EOptionType::Travels: return "Travel";
    case libvgcode::EOptionType::Wipes: return "Wipe";
    case libvgcode::EOptionType::Retractions: return "Retract";
    case libvgcode::EOptionType::Unretractions: return "Unretract";
    case libvgcode::EOptionType::Seams: return "Seams";
    case libvgcode::EOptionType::ToolChanges: return "Filament changes";
    default: return "Option";
    }
}

static const char* BED_VS =
    "#version 300 es\n"
    "layout(location = 0) in vec3 a_pos;\n"
    "layout(location = 1) in vec4 a_color;\n"
    "uniform mat4 u_mvp;\n"
    "out vec4 v_color;\n"
    "void main() {\n"
    "    v_color = a_color;\n"
    "    gl_Position = u_mvp * vec4(a_pos, 1.0);\n"
    "}\n";

static const char* BED_FS =
    "#version 300 es\n"
    "precision mediump float;\n"
    "in vec4 v_color;\n"
    "uniform float u_alpha;\n"
    "out vec4 fragColor;\n"
    "void main() {\n"
    "    fragColor = vec4(v_color.rgb, v_color.a * u_alpha);\n"
    "}\n";

} // namespace

class BedRenderer {
public:
    struct Vertex {
        float x, y, z;
        float r, g, b, a;
    };

    BedRenderer()
        : m_min_x(0.0f), m_min_y(0.0f), m_max_x(300.0f), m_max_y(300.0f)
        , m_program(0), m_u_mvp(-1), m_vao(0), m_vbo(0)
        , m_floor_count(0), m_lines_count(0), m_initialized(false)
    {
        m_polygon = { {0.0f, 0.0f}, {300.0f, 0.0f}, {300.0f, 300.0f}, {0.0f, 300.0f} };
    }

    ~BedRenderer() {
        cleanup();
    }

    void init() {
        if (m_initialized) return;

        GLuint vs = compileShader(GL_VERTEX_SHADER, BED_VS);
        GLuint fs = compileShader(GL_FRAGMENT_SHADER, BED_FS);
        if (!vs || !fs) {
            std::fprintf(stderr, "BedRenderer: Failed to compile shaders\n");
            return;
        }

        m_program = glCreateProgram();
        glAttachShader(m_program, vs);
        glAttachShader(m_program, fs);
        glLinkProgram(m_program);

        GLint linked = 0;
        glGetProgramiv(m_program, GL_LINK_STATUS, &linked);
        if (!linked) {
            char log[512];
            glGetProgramInfoLog(m_program, sizeof(log), nullptr, log);
            std::fprintf(stderr, "BedRenderer: Shader link error: %s\n", log);
            glDeleteProgram(m_program);
            m_program = 0;
            return;
        }

        glDeleteShader(vs);
        glDeleteShader(fs);

        m_u_mvp = glGetUniformLocation(m_program, "u_mvp");
        m_u_alpha = glGetUniformLocation(m_program, "u_alpha");

        glGenVertexArrays(1, &m_vao);
        glGenBuffers(1, &m_vbo);

        m_initialized = true;
        rebuildMesh();
    }

    void cleanup() {
        if (m_vao) {
            glDeleteVertexArrays(1, &m_vao);
            m_vao = 0;
        }
        if (m_vbo) {
            glDeleteBuffers(1, &m_vbo);
            m_vbo = 0;
        }
        if (m_program) {
            glDeleteProgram(m_program);
            m_program = 0;
        }
        m_initialized = false;
    }

    void setBed(float min_x, float min_y, float max_x, float max_y) {
        m_min_x = min_x;
        m_min_y = min_y;
        m_max_x = max_x;
        m_max_y = max_y;
        m_polygon.clear();
        m_polygon.push_back({min_x, min_y});
        m_polygon.push_back({max_x, min_y});
        m_polygon.push_back({max_x, max_y});
        m_polygon.push_back({min_x, max_y});
        if (m_initialized) rebuildMesh();
    }

    void setPolygon(const std::vector<std::pair<float, float>>& poly) {
        if (poly.size() >= 3) {
            m_polygon = poly;
            m_min_x = poly[0].first;
            m_max_x = poly[0].first;
            m_min_y = poly[0].second;
            m_max_y = poly[0].second;
            for (const auto& p : poly) {
                m_min_x = std::min(m_min_x, p.first);
                m_max_x = std::max(m_max_x, p.first);
                m_min_y = std::min(m_min_y, p.second);
                m_max_y = std::max(m_max_y, p.second);
            }
            if (m_initialized) rebuildMesh();
        }
    }

    // alpha < 1 draws the bed see-through (used when the camera is below it).
    void render(const libvgcode::Mat4x4& mvp, float alpha = 1.0f) {
        if (!m_initialized || m_program == 0) return;

        glUseProgram(m_program);
        glUniformMatrix4fv(m_u_mvp, 1, GL_FALSE, mvp.data());
        glUniform1f(m_u_alpha, alpha);
        glBindVertexArray(m_vao);

        if (m_floor_count > 0) {
            glDrawArrays(GL_TRIANGLES, 0, m_floor_count);
        }
        if (m_lines_count > 0) {
            glDrawArrays(GL_LINES, m_floor_count, m_lines_count);
        }

        glBindVertexArray(0);
        glUseProgram(0);
    }

    float getCenterX() const { return (m_min_x + m_max_x) * 0.5f; }
    float getCenterY() const { return (m_min_y + m_max_y) * 0.5f; }
    float getWidth() const { return m_max_x - m_min_x; }
    float getDepth() const { return m_max_y - m_min_y; }

private:
    GLuint compileShader(GLenum type, const char* src) {
        GLuint s = glCreateShader(type);
        glShaderSource(s, 1, &src, nullptr);
        glCompileShader(s);
        GLint compiled = 0;
        glGetShaderiv(s, GL_COMPILE_STATUS, &compiled);
        if (!compiled) {
            char log[512];
            glGetShaderInfoLog(s, sizeof(log), nullptr, log);
            std::fprintf(stderr, "BedRenderer: compileShader error: %s\n", log);
            glDeleteShader(s);
            return 0;
        }
        return s;
    }

    void rebuildMesh() {
        if (!m_initialized) return;

        std::vector<Vertex> verts;

        // 1. Bed subtle floor plate at z = -0.05 mm
        const float fz = -0.05f;
        const float fr = 0.14f, fg = 0.15f, fb = 0.17f, fa = 1.0f;
        verts.push_back({m_min_x, m_min_y, fz, fr, fg, fb, fa});
        verts.push_back({m_max_x, m_min_y, fz, fr, fg, fb, fa});
        verts.push_back({m_max_x, m_max_y, fz, fr, fg, fb, fa});

        verts.push_back({m_min_x, m_min_y, fz, fr, fg, fb, fa});
        verts.push_back({m_max_x, m_max_y, fz, fr, fg, fb, fa});
        verts.push_back({m_min_x, m_max_y, fz, fr, fg, fb, fa});

        m_floor_count = static_cast<GLsizei>(verts.size());

        // 2. Bed grid lines at z = 0.0 mm
        const float gz = 0.0f;
        const float gr = 0.22f, gg = 0.23f, gb = 0.26f, ga = 1.0f;
        const float step = 10.0f; // 10mm grid

        for (float x = std::ceil(m_min_x / step) * step; x <= m_max_x; x += step) {
            verts.push_back({x, m_min_y, gz, gr, gg, gb, ga});
            verts.push_back({x, m_max_y, gz, gr, gg, gb, ga});
        }
        for (float y = std::ceil(m_min_y / step) * step; y <= m_max_y; y += step) {
            verts.push_back({m_min_x, y, gz, gr, gg, gb, ga});
            verts.push_back({m_max_x, y, gz, gr, gg, gb, ga});
        }

        // 3. Bed boundary outline at z = 0.05 mm
        const float oz = 0.05f;
        const float or_ = 0.00f, og = 0.65f, ob = 0.60f, oa = 1.0f; // Orca teal
        if (m_polygon.size() >= 3) {
            for (size_t i = 0; i < m_polygon.size(); ++i) {
                size_t next = (i + 1) % m_polygon.size();
                verts.push_back({m_polygon[i].first, m_polygon[i].second, oz, or_, og, ob, oa});
                verts.push_back({m_polygon[next].first, m_polygon[next].second, oz, or_, og, ob, oa});
            }
        }

        // 4. Origin Axes at z = 0.1 mm
        const float az = 0.1f;
        const float axis_len = 30.0f;
        // X axis (red)
        verts.push_back({0.0f, 0.0f, az, 0.90f, 0.25f, 0.25f, 1.0f});
        verts.push_back({axis_len, 0.0f, az, 0.90f, 0.25f, 0.25f, 1.0f});
        // Y axis (green)
        verts.push_back({0.0f, 0.0f, az, 0.25f, 0.85f, 0.25f, 1.0f});
        verts.push_back({0.0f, axis_len, az, 0.25f, 0.85f, 0.25f, 1.0f});
        // Z axis (blue)
        verts.push_back({0.0f, 0.0f, az, 0.25f, 0.50f, 0.95f, 1.0f});
        verts.push_back({0.0f, 0.0f, az + axis_len, 0.25f, 0.50f, 0.95f, 1.0f});

        m_lines_count = static_cast<GLsizei>(verts.size() - m_floor_count);

        glBindVertexArray(m_vao);
        glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
        glBufferData(GL_ARRAY_BUFFER, verts.size() * sizeof(Vertex), verts.data(), GL_STATIC_DRAW);

        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, x));

        glEnableVertexAttribArray(1);
        glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, r));

        glBindVertexArray(0);
    }

    float m_min_x, m_min_y, m_max_x, m_max_y;
    std::vector<std::pair<float, float>> m_polygon;
    GLuint m_program;
    GLint m_u_mvp;
    GLint m_u_alpha = -1;
    GLuint m_vao;
    GLuint m_vbo;
    GLsizei m_floor_count;
    GLsizei m_lines_count;
    bool m_initialized;
};

class OrcaPreview {
public:
    OrcaPreview()
        : m_ctx(0)
        , m_width(800)
        , m_height(600)
        , m_target{150.0f, 150.0f, 10.0f}
        , m_distance(60.0f)
        , m_yaw(45.0f)
        , m_pitch(30.0f)
        , m_initialized(false)
        , m_last_view_type(libvgcode::EViewType::FeatureType)
    {
    }

    ~OrcaPreview() {
        if (m_initialized) {
            m_bed.cleanup();
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
        try {
        m_viewer.init("OpenGL ES 3.0");
        } catch (const std::exception& e) {
            std::fprintf(stderr, "OrcaPreview: Viewer::init failed: %s\n", e.what());
            return false;
        }

        // Initialize BedRenderer
        m_bed.init();

        // Desktop scrubs moves in the top layer while retaining earlier layers.
        if (!m_viewer.is_top_layer_only_view_range())
            m_viewer.toggle_top_layer_only_view_range();

        // Default viewport setup
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


        // Force color ranges recalculation on the newly loaded model in OpenGL ES via public API
        m_viewer.toggle_extrusion_role_visibility(libvgcode::EGCodeExtrusionRole::Custom);
        render();
        m_viewer.toggle_extrusion_role_visibility(libvgcode::EGCodeExtrusionRole::Custom);
        render();


        // Configure bed from result if available
        if (res.printable_area.size() >= 3) {
            std::vector<std::pair<float, float>> poly;
            for (const auto& pt : res.printable_area) {
                poly.push_back({static_cast<float>(pt.x()), static_cast<float>(pt.y())});
            }
            m_bed.setPolygon(poly);
        }

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
        m_distance = std::max(radius * 3.0f, 50.0f);
        m_yaw = 45.0f;
        m_pitch = 30.0f;

        size_t layers_count = m_viewer.get_layers_count();
        size_t moves_count = m_viewer.get_vertices_count();
        float time_s = processor.get_time(Slic3r::PrintEstimatedStatistics::ETimeMode::Normal);
        if (time_s <= 0.0f) {
            time_s = m_viewer.get_estimated_time();
        }

        // Extract filament statistics
        float filament_mm = 0.0f;
        float filament_g = 0.0f;
        for (const auto& kv : res.print_statistics.used_filaments_per_role) {
            filament_mm += static_cast<float>(kv.second.first * 1000.0);
            filament_g += static_cast<float>(kv.second.second);
        }
        if (filament_mm <= 0.0f && !res.moves.empty()) {
            for (const auto& mv : res.moves) {
                if (mv.delta_extruder > 0.0f) {
                    filament_mm += mv.delta_extruder;
                }
            }
            float density = (!res.filament_densities.empty() && res.filament_densities[0] > 0.0f) ? res.filament_densities[0] : 1.24f;
            float diam = (!res.filament_diameters.empty() && res.filament_diameters[0] > 0.0f) ? res.filament_diameters[0] : 1.75f;
            float r = diam * 0.5f;
            filament_g = (filament_mm * 3.14159f * r * r * density) / 1000.0f;
        }

        // Build feature breakdown
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(2);
        ss << "{\"layers\":" << layers_count
           << ",\"moves\":" << moves_count
           << ",\"timeS\":" << time_s
           << ",\"filamentMm\":" << filament_mm
           << ",\"filamentG\":" << filament_g
           << ",\"travelDistance\":" << res.print_statistics.total_travel_distance
           << ",\"travelMoves\":" << res.print_statistics.total_travel_moves
           << ",\"features\":[";

        bool first_feat = true;
        for (const auto role : m_viewer.get_extrusion_roles()) {
            float role_time = m_viewer.get_extrusion_role_estimated_time(role);
            if (role_time > 0.0f) {
                if (!first_feat) ss << ",";
                first_feat = false;
                float pct = (time_s > 0.0f) ? (role_time / time_s * 100.0f) : 0.0f;
                ss << "{\"name\":\"" << role_name(role) << "\""
                   << ",\"timeS\":" << role_time
                   << ",\"percent\":" << pct << "}";
            }
        }
        float travel_time = m_viewer.get_travels_estimated_time();
        if (travel_time > 0.0f) {
            if (!first_feat) ss << ",";
            float pct = (time_s > 0.0f) ? (travel_time / time_s * 100.0f) : 0.0f;
            ss << "{\"name\":\"Travel\",\"timeS\":" << travel_time << ",\"percent\":" << pct << "}";
        }
        ss << "]}";

        m_cached_stats_json = ss.str();
        return m_cached_stats_json;
    }

    void setLayerRange(int min_layer, int max_layer) {
        if (!m_initialized || m_viewer.get_layers_count() == 0) return;
        size_t count = m_viewer.get_layers_count();
        size_t cl_min = std::clamp<size_t>(min_layer, 0, count - 1);
        size_t cl_max = std::clamp<size_t>(max_layer, cl_min, count - 1);
        m_viewer.set_layers_view_range(cl_min, cl_max);
    }

    void setMove(int move) {
        if (!m_initialized) return;
        const auto& enabled = m_viewer.get_view_enabled_range();
        size_t m = std::clamp<size_t>(move, enabled[0], enabled[1]);
        m_viewer.set_view_visible_range(enabled[0], m);
    }

    std::string getMoveRange() const {
        if (!m_initialized) return "{\"min\":0,\"max\":0,\"current\":0}";
        const auto& enabled = m_viewer.get_view_enabled_range();
        const auto& visible = m_viewer.get_view_visible_range();
        char buf[128];
        std::snprintf(buf, sizeof(buf), "{\"min\":%zu,\"max\":%zu,\"current\":%zu}",
                      enabled[0], enabled[1], visible[1]);
        return std::string(buf);
    }

    std::string getLayersZs() const {
        if (!m_initialized) return "[]";
        const auto& zs = m_viewer.get_layers_zs();
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(3) << "[";
        for (size_t i = 0; i < zs.size(); ++i) {
            if (i > 0) ss << ",";
            ss << zs[i];
        }
        ss << "]";
        return ss.str();
    }

    float getLayerZ(int layer_idx) const {
        if (!m_initialized || layer_idx < 0) return 0.0f;
        return m_viewer.get_layer_z(static_cast<size_t>(layer_idx));
    }

    void setViewType(const std::string& name) {
        if (!m_initialized) return;

        std::string s = name;
        std::transform(s.begin(), s.end(), s.begin(), ::tolower);
        s.erase(std::remove_if(s.begin(), s.end(), [](char c) {
            return c == ' ' || c == '_' || c == '-';
        }), s.end());

        if (s == "featuretype" || s == "feature" || s == "linetype") {
            m_last_view_type = libvgcode::EViewType::FeatureType;
        } else if (s == "speed") {
            m_last_view_type = libvgcode::EViewType::Speed;
        } else if (s == "actualspeed") {
            m_last_view_type = libvgcode::EViewType::ActualSpeed;
        } else if (s == "height" || s == "layerheight") {
            m_last_view_type = libvgcode::EViewType::Height;
        } else if (s == "width" || s == "linewidth") {
            m_last_view_type = libvgcode::EViewType::Width;
        } else if (s == "tool") {
            m_last_view_type = libvgcode::EViewType::Tool;
        } else if (s == "colorprint") {
            m_last_view_type = libvgcode::EViewType::ColorPrint;
        } else if (s == "volumetricflowrate" || s == "volumetric" || s == "flow" || s == "flowrate") {
            m_last_view_type = libvgcode::EViewType::VolumetricFlowRate;
        } else if (s == "actualvolumetricflowrate" || s == "actualvolumetric" || s == "actualflow" || s == "actualflowrate") {
            m_last_view_type = libvgcode::EViewType::ActualVolumetricFlowRate;
        } else if (s == "fanspeed" || s == "fan") {
            m_last_view_type = libvgcode::EViewType::FanSpeed;
        } else if (s == "temperature" || s == "temp") {
            m_last_view_type = libvgcode::EViewType::Temperature;
        } else if (s == "pressureadvance" || s == "pa") {
            m_last_view_type = libvgcode::EViewType::PressureAdvance;
        } else if (s == "acceleration" || s == "accel") {
            m_last_view_type = libvgcode::EViewType::Acceleration;
        } else if (s == "jerk") {
            m_last_view_type = libvgcode::EViewType::Jerk;
        } else if (s == "layertimelogarithmic" || s == "layertimelog" || s == "timelog") {
            m_last_view_type = libvgcode::EViewType::LayerTimeLogarithmic;
        } else if (s == "layertime" || s == "layertimelinear" || s == "time") {
            m_last_view_type = libvgcode::EViewType::LayerTimeLinear;
        } else if (s == "summary") {
            m_last_view_type = libvgcode::EViewType::Summary;
        } else {
            m_last_view_type = libvgcode::EViewType::FeatureType;
        }

        m_viewer.set_view_type(m_last_view_type);
        render();
    }

    std::string getLegendData() const {
        if (!m_initialized) return "{}";

        std::ostringstream ss;
        ss << std::fixed << std::setprecision(1);

        switch (m_last_view_type) {
        case libvgcode::EViewType::FeatureType: {
            ss << "{\"viewType\":\"FeatureType\",\"title\":\"Line Type\",\"type\":\"features\",\"items\":[";
            bool first = true;
            for (const auto role : m_viewer.get_extrusion_roles()) {
                if (!first) ss << ",";
                first = false;
                std::string col = to_hex(m_viewer.get_extrusion_role_color(role));
                bool vis = m_viewer.is_extrusion_role_visible(role);
                float role_time = m_viewer.get_extrusion_role_estimated_time(role);
                ss << "{\"id\":" << static_cast<int>(role)
                   << ",\"name\":\"" << role_name(role) << "\""
                   << ",\"color\":\"" << col << "\""
                   << ",\"visible\":" << (vis ? "true" : "false")
                   << ",\"timeS\":" << role_time << "}";
            }
            ss << "],\"options\":[";
            bool first_opt = true;
            for (const auto opt : m_viewer.get_options()) {
                if (!first_opt) ss << ",";
                first_opt = false;
                std::string col = to_hex(m_viewer.get_option_color(opt));
                bool vis = m_viewer.is_option_visible(opt);
                ss << "{\"id\":" << static_cast<int>(opt)
                   << ",\"name\":\"" << option_name(opt) << "\""
                   << ",\"color\":\"" << col << "\""
                   << ",\"visible\":" << (vis ? "true" : "false") << "}";
            }
            ss << "]}";
            break;
        }
        case libvgcode::EViewType::Tool: {
            ss << "{\"viewType\":\"Tool\",\"title\":\"Filament / Tool\",\"type\":\"tool\",\"items\":[";
            const auto& tools = m_viewer.get_used_extruders_ids();
            const auto& pal = m_viewer.get_tool_colors();
            for (size_t i = 0; i < tools.size(); ++i) {
                if (i > 0) ss << ",";
                uint8_t tool_id = tools[i];
                std::string col = (tool_id < pal.size()) ? to_hex(pal[tool_id]) : "#009688";
                ss << "{\"id\":" << static_cast<int>(tool_id)
                   << ",\"name\":\"Extruder " << (tool_id + 1) << "\""
                   << ",\"color\":\"" << col << "\""
                   << ",\"visible\":true}";
            }
            ss << "],\"options\":[]}";
            break;
        }
        case libvgcode::EViewType::ColorPrint: {
            ss << "{\"viewType\":\"ColorPrint\",\"title\":\"Filament\",\"type\":\"tool\",\"items\":[";
            const auto& tools = m_viewer.get_used_extruders_ids();
            const auto& pal = m_viewer.get_color_print_colors_count() > 0 ? m_viewer.get_color_print_colors() : m_viewer.get_tool_colors();
            for (size_t i = 0; i < tools.size(); ++i) {
                if (i > 0) ss << ",";
                uint8_t tool_id = tools[i];
                std::string col = (tool_id < pal.size()) ? to_hex(pal[tool_id]) : "#009688";
                ss << "{\"id\":" << static_cast<int>(tool_id)
                   << ",\"name\":\"Filament " << (tool_id + 1) << "\""
                   << ",\"color\":\"" << col << "\""
                   << ",\"visible\":true}";
            }
            ss << "],\"options\":[]}";
            break;
        }
        case libvgcode::EViewType::Summary: {
            ss << "{\"viewType\":\"Summary\",\"title\":\"Summary\",\"type\":\"tool\",\"items\":[";
            const auto& tools = m_viewer.get_used_extruders_ids();
            const auto& pal = m_viewer.get_color_print_colors_count() > 0 ? m_viewer.get_color_print_colors() : m_viewer.get_tool_colors();
            for (size_t i = 0; i < tools.size(); ++i) {
                if (i > 0) ss << ",";
                uint8_t tool_id = tools[i];
                std::string col = (tool_id < pal.size()) ? to_hex(pal[tool_id]) : "#009688";
                ss << "{\"id\":" << static_cast<int>(tool_id)
                   << ",\"name\":\"Extruder " << (tool_id + 1) << "\""
                   << ",\"color\":\"" << col << "\""
                   << ",\"visible\":true}";
            }
            ss << "],\"options\":[]}";
            break;
        }
        default: {
            std::string title = "Range";
            std::string vt_name = "Range";
            if (m_last_view_type == libvgcode::EViewType::Speed) { title = "Speed (mm/s)"; vt_name = "Speed"; }
            else if (m_last_view_type == libvgcode::EViewType::ActualSpeed) { title = "Actual Speed (mm/s)"; vt_name = "ActualSpeed"; }
            else if (m_last_view_type == libvgcode::EViewType::Height) { title = "Layer Height (mm)"; vt_name = "Height"; }
            else if (m_last_view_type == libvgcode::EViewType::Width) { title = "Line Width (mm)"; vt_name = "Width"; }
            else if (m_last_view_type == libvgcode::EViewType::FanSpeed) { title = "Fan Speed (%)"; vt_name = "FanSpeed"; }
            else if (m_last_view_type == libvgcode::EViewType::Temperature) { title = "Temperature (°C)"; vt_name = "Temperature"; }
            else if (m_last_view_type == libvgcode::EViewType::VolumetricFlowRate) { title = "Flow Rate (mm³/s)"; vt_name = "VolumetricFlowRate"; }
            else if (m_last_view_type == libvgcode::EViewType::ActualVolumetricFlowRate) { title = "Actual Flow Rate (mm³/s)"; vt_name = "ActualVolumetricFlowRate"; }
            else if (m_last_view_type == libvgcode::EViewType::LayerTimeLinear) { title = "Layer Time (s)"; vt_name = "LayerTimeLinear"; }
            else if (m_last_view_type == libvgcode::EViewType::LayerTimeLogarithmic) { title = "Layer Time (log)"; vt_name = "LayerTimeLogarithmic"; }
            else if (m_last_view_type == libvgcode::EViewType::PressureAdvance) { title = "Pressure Advance"; vt_name = "PressureAdvance"; }
            else if (m_last_view_type == libvgcode::EViewType::Acceleration) { title = "Acceleration (mm/s²)"; vt_name = "Acceleration"; }
            else if (m_last_view_type == libvgcode::EViewType::Jerk) { title = "Jerk (mm/s)"; vt_name = "Jerk"; }

            ss << "{\"viewType\":\"" << vt_name << "\",\"title\":\"" << title << "\",\"type\":\"range\",\"ranges\":[";
            const auto& range = m_viewer.get_color_range(m_last_view_type);
            const auto& pal = range.get_palette();
            const auto& vals = range.get_values();

            const auto& interval = range.get_range();
            bool valid_range = std::isfinite(interval[0]) && std::isfinite(interval[1]) && interval[1] >= interval[0];
            if (valid_range && !vals.empty()) {
                if (vals.size() == pal.size()) {
                    for (int i = static_cast<int>(pal.size()) - 1; i >= 0; --i) {
                        if (i < static_cast<int>(pal.size()) - 1) ss << ",";
                        float val = vals[i];
                        ss << "{\"color\":\"" << to_hex(pal[i]) << "\",\"value\":" << (std::isfinite(val) ? val : 0.0f) << "}";
                    }
                } else if (vals.size() == 2) {
                    ss << "{\"color\":\"" << to_hex(pal.back()) << "\",\"value\":" << (std::isfinite(vals.back()) ? vals.back() : 0.0f) << "},";
                    ss << "{\"color\":\"" << to_hex(pal.front()) << "\",\"value\":" << (std::isfinite(vals.front()) ? vals.front() : 0.0f) << "}";
                } else if (vals.size() == 1) {
                    ss << "{\"color\":\"" << to_hex(pal.front()) << "\",\"value\":" << (std::isfinite(vals.front()) ? vals.front() : 0.0f) << "}";
                }
            }
            ss << "],\"options\":[";
            // Include Travel toggle for range views
            std::string tr_col = to_hex(m_viewer.get_option_color(libvgcode::EOptionType::Travels));
            bool tr_vis = m_viewer.is_option_visible(libvgcode::EOptionType::Travels);
            ss << "{\"id\":" << static_cast<int>(libvgcode::EOptionType::Travels)
               << ",\"name\":\"Travel\",\"color\":\"" << tr_col << "\",\"visible\":" << (tr_vis ? "true" : "false") << "}";
            ss << "]}";
            break;
        }
        }

        return ss.str();
    }


    void toggleExtrusionRole(int role) {
        if (!m_initialized) return;
        m_viewer.toggle_extrusion_role_visibility(static_cast<libvgcode::EGCodeExtrusionRole>(role));
    }

    void setExtrusionRoleVisible(int role, bool visible) {
        if (!m_initialized) return;
        auto r = static_cast<libvgcode::EGCodeExtrusionRole>(role);
        if (m_viewer.is_extrusion_role_visible(r) != visible) {
            m_viewer.toggle_extrusion_role_visibility(r);
        }
    }

    void toggleOption(int opt) {
        if (!m_initialized) return;
        m_viewer.toggle_option_visibility(static_cast<libvgcode::EOptionType>(opt));
    }

    void setOptionVisible(int opt, bool visible) {
        if (!m_initialized) return;
        auto o = static_cast<libvgcode::EOptionType>(opt);
        if (m_viewer.is_option_visible(o) != visible) {
            m_viewer.toggle_option_visibility(o);
        }
    }

    void setBed(float min_x, float min_y, float max_x, float max_y) {
        m_bed.setBed(min_x, min_y, max_x, max_y);
    }

    void setBedPolygon(emscripten::val pointsArr) {
        std::vector<std::pair<float, float>> poly;
        size_t len = pointsArr["length"].as<size_t>();
        for (size_t i = 0; i < len; ++i) {
            emscripten::val p = pointsArr[i];
            float x = p[0].as<float>();
            float y = p[1].as<float>();
            poly.push_back({x, y});
        }
        m_bed.setPolygon(poly);
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
        m_distance = std::max(radius * 3.0f, 50.0f);
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
    std::string getSliceStatistics() const { return m_cached_stats_json; }

private:
    void do_render(const libvgcode::Mat4x4& view, const libvgcode::Mat4x4& proj) {
        emscripten_webgl_make_context_current(m_ctx);

        glViewport(0, 0, m_width, m_height);
        glClearColor(0.13f, 0.14f, 0.16f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        glEnable(GL_DEPTH_TEST);
        glDepthFunc(GL_LEQUAL);

        libvgcode::Mat4x4 mvp = multiply_mat4(proj, view);
        // Camera position along Z (column-major view = [R|t], eye = -R^T t). Seen from below, the bed is
        // drawn after the toolpaths and blended over them, so parts stay visible through it.
        const float eye_z = -(view[8] * view[12] + view[9] * view[13] + view[10] * view[14]);
        if (eye_z < 0.0f) {
            m_viewer.render(view, proj);
            glEnable(GL_BLEND);
            glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
            glDepthMask(GL_FALSE);
            m_bed.render(mvp, 0.25f);
            glDepthMask(GL_TRUE);
            glDisable(GL_BLEND);
        } else {
            m_bed.render(mvp);
            m_viewer.render(view, proj);
        }
    }

    libvgcode::Viewer m_viewer;
    BedRenderer m_bed;
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE m_ctx;
    int m_width;
    int m_height;
    libvgcode::Vec3 m_target;
    float m_distance;
    float m_yaw;
    float m_pitch;
    bool m_initialized;
    libvgcode::EViewType m_last_view_type;
    std::string m_cached_stats_json;
};

EMSCRIPTEN_BINDINGS(orca_preview) {
    emscripten::class_<OrcaPreview>("OrcaPreview")
        .constructor<>()
        .function("init", &OrcaPreview::init)
        .function("loadGcode", &OrcaPreview::loadGcode)
        .function("setLayerRange", &OrcaPreview::setLayerRange)
        .function("setMove", &OrcaPreview::setMove)
        .function("getMoveRange", &OrcaPreview::getMoveRange)
        .function("getLayersZs", &OrcaPreview::getLayersZs)
        .function("getLayerZ", &OrcaPreview::getLayerZ)
        .function("setViewType", &OrcaPreview::setViewType)
        .function("getLegendData", &OrcaPreview::getLegendData)
        .function("toggleExtrusionRole", &OrcaPreview::toggleExtrusionRole)
        .function("setExtrusionRoleVisible", &OrcaPreview::setExtrusionRoleVisible)
        .function("toggleOption", &OrcaPreview::toggleOption)
        .function("setOptionVisible", &OrcaPreview::setOptionVisible)
        .function("setBed", &OrcaPreview::setBed)
        .function("setBedPolygon", &OrcaPreview::setBedPolygon)
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
        .function("getSliceStatistics", &OrcaPreview::getSliceStatistics)
        ;
}

int main() {
    return 0;
}
