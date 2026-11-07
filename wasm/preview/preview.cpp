#include "libslic3r/Utils.hpp"
#include "libslic3r/libslic3r.h"
#include "libslic3r/Point.hpp"
#include "libslic3r/Polygon.hpp"
#include "libslic3r/ExPolygon.hpp"
#include "libslic3r/Tesselate.hpp"
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
#include <utility>
#include <exception>
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

inline std::string to_hex(const libvgcode::ColorWithAlpha& c) {
    return to_hex(libvgcode::Color{ c[0], c[1], c[2] });
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
    "out vec3 v_position;\n"
    "void main() {\n"
    "    v_color = a_color;\n"
    "    v_position = a_pos;\n"
    "    gl_Position = u_mvp * vec4(a_pos, 1.0);\n"
    "}\n";

static const char* BED_FS =
    "#version 300 es\n"
    "precision highp float;\n"
    "precision highp sampler2D;\n"
    "in vec4 v_color;\n"
    "in vec3 v_position;\n"
    "uniform float u_alpha;\n"
    "uniform sampler2D u_shadow_map;\n"
    "uniform mat4 u_light_vp;\n"
    "uniform float u_shadow_intensity;\n"
    "float shadow_sample(ivec2 p, float receiver_depth) {\n"
    "    ivec2 size = textureSize(u_shadow_map, 0);\n"
    "    if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return 0.0;\n"
    "    return receiver_depth > texelFetch(u_shadow_map, p, 0).r ? 1.0 : 0.0;\n"
    "}\n"
    "float filtered_shadow(vec2 uv, float receiver_depth) {\n"
    "    vec2 p = uv * vec2(textureSize(u_shadow_map, 0)) - 0.5;\n"
    "    ivec2 i = ivec2(floor(p));\n"
    "    vec2 f = fract(p);\n"
    "    return mix(mix(shadow_sample(i, receiver_depth), shadow_sample(i + ivec2(1, 0), receiver_depth), f.x),\n"
    "               mix(shadow_sample(i + ivec2(0, 1), receiver_depth), shadow_sample(i + ivec2(1, 1), receiver_depth), f.x), f.y);\n"
    "}\n"
    "float shadow() {\n"
    "    if (u_shadow_intensity <= 0.0) return 1.0;\n"
    "    vec4 lp = u_light_vp * vec4(v_position, 1.0);\n"
    "    if (lp.w <= 0.0) return 1.0;\n"
    "    vec3 p = lp.xyz / lp.w * 0.5 + 0.5;\n"
    "    if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) return 1.0;\n"
    "    float sum = 0.0;\n"
    "    vec2 texel = 1.0 / vec2(textureSize(u_shadow_map, 0));\n"
    "    for (int x = -1; x <= 1; ++x)\n"
    "        for (int y = -1; y <= 1; ++y)\n"
    "            sum += filtered_shadow(p.xy + vec2(float(x), float(y)) * texel, p.z - 0.00126);\n"
    "    return 1.0 - u_shadow_intensity * sum / 9.0;\n"
    "}\n"
    "out vec4 fragColor;\n"
    "void main() {\n"
    "    fragColor = vec4(v_color.rgb * shadow(), v_color.a * u_alpha);\n"
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
        m_u_shadow_map = glGetUniformLocation(m_program, "u_shadow_map");
        m_u_light_vp = glGetUniformLocation(m_program, "u_light_vp");
        m_u_shadow_intensity = glGetUniformLocation(m_program, "u_shadow_intensity");

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
    void render(const libvgcode::Mat4x4& mvp, float alpha = 1.0f,
                const libvgcode::Mat4x4& light_vp = {}, float shadow_intensity = 0.0f) {
        if (!m_initialized || m_program == 0) return;

        glUseProgram(m_program);
        glUniformMatrix4fv(m_u_mvp, 1, GL_FALSE, mvp.data());
        glUniform1f(m_u_alpha, alpha);
        glUniform1i(m_u_shadow_map, 4);
        glUniformMatrix4fv(m_u_light_vp, 1, GL_FALSE, light_vp.data());
        glUniform1f(m_u_shadow_intensity, shadow_intensity);
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

    void setLightTheme(bool light) {
        if (m_light_theme == light) return;
        m_light_theme = light;
        rebuildMesh();
    }

    const std::vector<std::pair<float, float>>& getPolygon() const { return m_polygon; }

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
        const float fr = m_light_theme ? 0.83f : 0.14f, fg = m_light_theme ? 0.85f : 0.15f, fb = m_light_theme ? 0.87f : 0.17f, fa = 1.0f;
        Slic3r::Polygon polygon;
        for (const auto& p : m_polygon)
            polygon.points.emplace_back(Slic3r::scaled<coord_t>(p.first), Slic3r::scaled<coord_t>(p.second));
        polygon.make_counter_clockwise();
        for (const auto& p : Slic3r::triangulate_expolygon_2f(Slic3r::ExPolygon(polygon)))
            verts.push_back({p.x(), p.y(), fz, fr, fg, fb, fa});

        m_floor_count = static_cast<GLsizei>(verts.size());

        // 2. Bed grid lines at z = 0.0 mm
        const float gz = 0.0f;
        const float gr = 0.22f, gg = 0.23f, gb = 0.26f, ga = 1.0f;
        const float step = std::max(10.0f, std::ceil(std::max(getWidth(), getDepth()) / 10000.0f) * 10.0f);
        // Pair polygon intersections to clip grid lines, including concave notches.
        for (int axis = 0; axis < 2; ++axis) {
            const float min = axis == 0 ? m_min_x : m_min_y;
            const float max = axis == 0 ? m_max_x : m_max_y;
            for (float value = std::ceil(min / step) * step; value <= max; value += step) {
                std::vector<float> intersections;
                for (size_t i = 0; i < m_polygon.size(); ++i) {
                    const auto& a = m_polygon[i];
                    const auto& b = m_polygon[(i + 1) % m_polygon.size()];
                    const float av = axis == 0 ? a.first : a.second;
                    const float bv = axis == 0 ? b.first : b.second;
                    if ((av <= value && value < bv) || (bv <= value && value < av)) {
                        const float other_a = axis == 0 ? a.second : a.first;
                        const float other_b = axis == 0 ? b.second : b.first;
                        intersections.push_back(other_a + (other_b - other_a) * (value - av) / (bv - av));
                    }
                }
                std::sort(intersections.begin(), intersections.end());
                for (size_t i = 0; i + 1 < intersections.size(); i += 2) {
                    for (size_t j = i; j <= i + 1; ++j) {
                        const float other = intersections[j];
                        verts.push_back({axis == 0 ? value : other, axis == 0 ? other : value, gz, gr, gg, gb, ga});
                    }
                }
            }
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
    GLint m_u_shadow_map = -1;
    GLint m_u_light_vp = -1;
    GLint m_u_shadow_intensity = -1;
    GLuint m_vao;
    GLuint m_vbo;
    GLsizei m_floor_count;
    GLsizei m_lines_count;
    bool m_initialized;
    bool m_light_theme = false;
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
        if (m_ctx > 0)
            emscripten_webgl_make_context_current(m_ctx);
        if (m_initialized) {
            if (m_shadow_fbo) glDeleteFramebuffers(1, &m_shadow_fbo);
            if (m_shadow_texture) glDeleteTextures(1, &m_shadow_texture);
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
        Slic3r::set_resources_dir("/resources");

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

    void setToolColors(emscripten::val colors) {
        emscripten_webgl_make_context_current(m_ctx);
        libvgcode::PaletteWithAlpha palette = m_viewer.get_tool_colors();
        const unsigned count = std::min(colors["length"].as<unsigned>(), 256u);
        palette.resize(std::max(palette.size(), static_cast<size_t>(count)), libvgcode::convert(std::string("#009688")));
        for (unsigned i = 0; i < count; ++i) {
            const std::string color = colors[i].as<std::string>();
            if (!color.empty()) palette[i] = libvgcode::convert(color);
        }
        m_viewer.set_tool_colors(palette);
    }

    std::string loadGcode(const std::string& path) {
        if (!m_initialized) {
            std::fprintf(stderr, "OrcaPreview: Must call init() before loadGcode()\n");
            return "{\"error\":\"Not initialized\"}";
        }

        emscripten_webgl_make_context_current(m_ctx);

        // Report an inaccessible MEMFS input before entering the processor's error
        // path, and leave the successfully loaded preview available to the caller.
        std::FILE* input = std::fopen(path.c_str(), "rb");
        if (input == nullptr)
            return "{\"error\":\"Cannot open G-code file\"}";
        std::fclose(input);

        libvgcode::GCodeInputData data;
        std::vector<std::pair<float, float>> bed_polygon;
        double time_s = 0.0;
        float filament_mm = 0.0f;
        float filament_g = 0.0f;
        float travel_distance = 0.0f;
        unsigned int travel_moves = 0;
        {
            // Keep processor storage local so it is released after conversion,
            // before allocating the renderer's texture staging arrays.
            m_viewer.release_cpu_render_cache();
            Slic3r::GCodeProcessor processor;
            try {
                processor.process_file(path, nullptr, false);
            } catch (const std::exception& e) {
                std::fprintf(stderr, "OrcaPreview: GCodeProcessor::process_file failed on '%s': %s\n", path.c_str(), e.what());
                // Exception text can contain quotes/newlines; keep the recoverable error valid JSON.
                return "{\"error\":\"Failed to parse G-code\"}";
            }

            const Slic3r::GCodeProcessorResult& res = processor.get_result();

            // An empty replacement leaves the previous data, statistics and camera intact.
            if (res.moves.size() <= 1)
                return "{\"error\":\"No toolpath moves in G-code\"}";
            m_extrusion_bounds_valid = false;
            m_viewer.reset();

            std::vector<std::string> tool_colors = res.extruder_colors;
            if (tool_colors.empty()) {
                tool_colors.push_back("#009688");
            }
            std::vector<std::string> cp_colors;

            data = libvgcode::convert(res, tool_colors, cp_colors, m_viewer);
            time_s = processor.get_time(Slic3r::PrintEstimatedStatistics::ETimeMode::Normal);
            // Extract filament statistics
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

            // Configure bed from result if available
            if (res.printable_area.size() >= 3) {
                for (const auto& pt : res.printable_area) {
                    bed_polygon.push_back({static_cast<float>(pt.x()), static_cast<float>(pt.y())});
                }
            }

            travel_distance = res.print_statistics.total_travel_distance;
            travel_moves = res.print_statistics.total_travel_moves;
        }
        m_viewer.reset_default_extrusion_roles_colors();
        m_viewer.load(std::move(data));

        if (!bed_polygon.empty())
            m_bed.setPolygon(bed_polygon);

        // Center camera specifically on extrusion bounds (avoiding travel moves from origin)
        libvgcode::AABox bbox = m_viewer.get_bounding_box({ libvgcode::EMoveType::Extrude });
        // Raw extrusion positions only change on replacement or clear. Keep the
        // unexpanded box even when ranges, visibility or the camera change.
        m_extrusion_bounds = bbox;
        m_extrusion_bounds_valid = true;
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
        if (time_s <= 0.0f)
            time_s = m_viewer.get_estimated_time();

        // Build feature breakdown
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(2);
        ss << "{\"layers\":" << layers_count
           << ",\"moves\":" << moves_count
           << ",\"timeS\":" << time_s
           << ",\"filamentMm\":" << filament_mm
           << ",\"filamentG\":" << filament_g
           << ",\"travelDistance\":" << travel_distance
           << ",\"travelMoves\":" << travel_moves
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

    // Expose processor values for numeric preview verification.
    std::string getMoveInfo(int move) const {
        if (!m_initialized || move < 0 || static_cast<size_t>(move) >= m_viewer.get_vertices_count()) {
            return "{}";
        }
        const auto& vertex = m_viewer.get_vertex_at(static_cast<size_t>(move));
        char buf[512];
        std::snprintf(buf, sizeof(buf),
            "{\"position\":[%.3f,%.3f,%.3f],\"height\":%.4f,\"width\":%.4f,\"feedrate\":%.2f,\"actual_feedrate\":%.2f,\"fan_speed\":%.2f,\"temperature\":%.2f,\"role\":%d,\"type\":%d,\"pressure_advance\":%.4f,\"volumetric_rate\":%.4f,\"gcode_id\":%u}",
            vertex.position[0], vertex.position[1], vertex.position[2],
            vertex.height, vertex.width, vertex.feedrate, vertex.actual_feedrate,
            vertex.fan_speed, vertex.temperature, static_cast<int>(vertex.role), static_cast<int>(vertex.type),
            vertex.pressure_advance, vertex.volumetric_rate(), vertex.gcode_id
        );
        return std::string(buf);
    }

    unsigned int getMoveGcodeLine(int move) const {
        if (!m_initialized || move < 0 || static_cast<size_t>(move) >= m_viewer.get_vertices_count()) return 0;
        return m_viewer.get_vertex_at(static_cast<size_t>(move)).gcode_id;
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
            if (m_viewer.get_vertices_count() == 0) {
                ss << "],\"options\":[]}";
                break;
            }
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
                        ss << "{\"color\":\"" << to_hex(m_low_quality ? range.get_color_at(val, 8) : pal[i]) << "\",\"value\":" << (std::isfinite(val) ? val : 0.0f) << "}";
                    }
                } else if (vals.size() == 2) {
                    ss << "{\"color\":\"" << to_hex(m_low_quality ? range.get_color_at(vals.back(), 8) : pal.back()) << "\",\"value\":" << (std::isfinite(vals.back()) ? vals.back() : 0.0f) << "},";
                    ss << "{\"color\":\"" << to_hex(m_low_quality ? range.get_color_at(vals.front(), 8) : pal.front()) << "\",\"value\":" << (std::isfinite(vals.front()) ? vals.front() : 0.0f) << "}";
                } else if (vals.size() == 1) {
                    ss << "{\"color\":\"" << to_hex(m_low_quality ? range.get_color_at(vals.front(), 8) : pal.front()) << "\",\"value\":" << (std::isfinite(vals.front()) ? vals.front() : 0.0f) << "}";
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

    void setClippingPlane(float x, float y, float z, float offset) {
        m_viewer.set_clipping_plane({ x, y, z, offset });
    }

    void setLowQuality(bool enabled) {
        m_low_quality = enabled;
        m_viewer.set_low_quality(enabled);
    }

    void setLightTheme(bool light) {
        m_light_theme = light;
        m_bed.setLightTheme(light);
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

    emscripten::val getBedPolygon() const {
        auto result = emscripten::val::array();
        for (const auto& point : m_bed.getPolygon()) {
            auto p = emscripten::val::array();
            p.call<void>("push", point.first);
            p.call<void>("push", point.second);
            result.call<void>("push", p);
        }
        return result;
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
        if (!m_initialized || m_viewer.get_vertices_count() == 0) return;
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

    void setShadowsEnabled(bool enabled) { m_shadows_enabled = enabled; }
    void setLightingEnabled(bool enabled) { m_lighting_enabled = enabled; }

    void clearGcode() {
        if (!m_initialized) return;
        emscripten_webgl_make_context_current(m_ctx);
        m_extrusion_bounds_valid = false;
        m_viewer.reset();
        m_cached_stats_json.clear();
    }

    size_t getLayersCount() const { return m_viewer.get_layers_count(); }
    size_t getMovesCount() const { return m_viewer.get_vertices_count(); }
    float getEstimatedTime() const { return m_viewer.get_estimated_time(); }
    std::string getSliceStatistics() const { return m_cached_stats_json; }
    std::string getRenderMemoryUsage() const {
        char buf[128];
        std::snprintf(buf, sizeof(buf), "{\"cpuBytes\":%zu,\"gpuBytes\":%zu}",
                      m_viewer.get_used_cpu_memory(), m_viewer.get_used_gpu_memory());
        return std::string(buf);
    }

private:
    bool render_shadows(libvgcode::Mat4x4& light_vp) {
        if (!m_lighting_enabled || !m_shadows_enabled || m_low_quality || m_shadow_failed || !m_extrusion_bounds_valid || m_viewer.get_vertices_count() == 0)
            return false;

        auto bounds = m_extrusion_bounds;
        for (int axis = 0; axis < 3; ++axis)
            if (!std::isfinite(bounds[0][axis]) || !std::isfinite(bounds[1][axis]) || bounds[0][axis] > bounds[1][axis])
                return false;
        // Include the receiving plane and enough space for the projected silhouette on it.
        bounds[0][2] = std::min(bounds[0][2], -0.05f);
        const float height = std::max(0.0f, bounds[1][2]);
        for (int axis = 0; axis < 2; ++axis) {
            const float shift = -height * LIGHT_DIRECTION[axis] / LIGHT_DIRECTION[2];
            bounds[0][axis] += std::min(shift, 0.0f) - 2.0f;
            bounds[1][axis] += std::max(shift, 0.0f) + 2.0f;
        }
        libvgcode::Vec3 center{};
        float radius_sq = 0.0f;
        for (int axis = 0; axis < 3; ++axis) {
            center[axis] = 0.5f * (bounds[0][axis] + bounds[1][axis]);
            const float extent = bounds[1][axis] - bounds[0][axis];
            radius_sq += extent * extent;
        }
        const float distance = std::max(10.0f, std::sqrt(radius_sq) + 10.0f);
        if (!std::isfinite(distance)) return false;
        const libvgcode::Vec3 light_position = {
            center[0] + distance * LIGHT_DIRECTION[0],
            center[1] + distance * LIGHT_DIRECTION[1],
            center[2] + distance * LIGHT_DIRECTION[2]};
        const auto light_view = compute_lookat(light_position, center, {0.0f, 0.0f, 1.0f});
        libvgcode::Vec3 lo{INFINITY, INFINITY, INFINITY}, hi{-INFINITY, -INFINITY, -INFINITY};
        for (int corner = 0; corner < 8; ++corner) {
            libvgcode::Vec3 p{bounds[corner & 1][0], bounds[(corner >> 1) & 1][1], bounds[(corner >> 2) & 1][2]};
            for (int row = 0; row < 3; ++row) {
                const float v = light_view[row] * p[0] + light_view[4 + row] * p[1] + light_view[8 + row] * p[2] + light_view[12 + row];
                lo[row] = std::min(lo[row], v - 2.0f);
                hi[row] = std::max(hi[row], v + 2.0f);
            }
        }
        libvgcode::Mat4x4 light_proj{};
        light_proj[0] = 2.0f / (hi[0] - lo[0]);
        light_proj[5] = 2.0f / (hi[1] - lo[1]);
        light_proj[10] = -2.0f / (hi[2] - lo[2]);
        light_proj[12] = -(hi[0] + lo[0]) / (hi[0] - lo[0]);
        light_proj[13] = -(hi[1] + lo[1]) / (hi[1] - lo[1]);
        light_proj[14] = (hi[2] + lo[2]) / (hi[2] - lo[2]);
        light_proj[15] = 1.0f;
        light_vp = multiply_mat4(light_proj, light_view);
        for (float value : light_vp)
            if (!std::isfinite(value)) return false;

        GLint draw_fbo, read_fbo, viewport[4], depth_func, active_texture, texture;
        GLboolean color_mask[4], depth_mask;
        GLfloat clear_depth;
        glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &draw_fbo);
        glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &read_fbo);
        glGetIntegerv(GL_VIEWPORT, viewport);
        glGetIntegerv(GL_DEPTH_FUNC, &depth_func);
        glGetBooleanv(GL_COLOR_WRITEMASK, color_mask);
        glGetBooleanv(GL_DEPTH_WRITEMASK, &depth_mask);
        glGetFloatv(GL_DEPTH_CLEAR_VALUE, &clear_depth);
        const GLboolean depth_test = glIsEnabled(GL_DEPTH_TEST), blend = glIsEnabled(GL_BLEND);
        const GLboolean cull = glIsEnabled(GL_CULL_FACE), scissor = glIsEnabled(GL_SCISSOR_TEST);
        glGetIntegerv(GL_ACTIVE_TEXTURE, &active_texture);
        glActiveTexture(GL_TEXTURE4);
        glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);

        if (!m_shadow_fbo) {
            GLint max_size;
            glGetIntegerv(GL_MAX_TEXTURE_SIZE, &max_size);
            m_shadow_size = std::min(2048, max_size);
            glGenTextures(1, &m_shadow_texture);
            glBindTexture(GL_TEXTURE_2D, m_shadow_texture);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, m_shadow_size, m_shadow_size, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, nullptr);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_MODE, GL_NONE);
            glGenFramebuffers(1, &m_shadow_fbo);
            glBindFramebuffer(GL_FRAMEBUFFER, m_shadow_fbo);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, m_shadow_texture, 0);
            const GLenum none = GL_NONE;
            glDrawBuffers(1, &none);
            glReadBuffer(GL_NONE);
            m_shadow_failed = glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE;
            if (m_shadow_failed)
                std::fprintf(stderr, "OrcaPreview: depth framebuffer unsupported; using unshadowed lighting\n");
        }
        if (!m_shadow_failed) {
            glBindFramebuffer(GL_FRAMEBUFFER, m_shadow_fbo);
            // Do not sample the attached depth texture during the caster pass.
            glBindTexture(GL_TEXTURE_2D, 0);
            glViewport(0, 0, m_shadow_size, m_shadow_size);
            glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
            glDepthMask(GL_TRUE);
            glEnable(GL_DEPTH_TEST);
            glDepthFunc(GL_LESS);
            glDisable(GL_BLEND);
            glDisable(GL_SCISSOR_TEST);
            glClearDepthf(1.0f);
            glClear(GL_DEPTH_BUFFER_BIT);
            m_viewer.render_shadow_casters(light_view, light_proj, light_position);
        }

        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, draw_fbo);
        glBindFramebuffer(GL_READ_FRAMEBUFFER, read_fbo);
        glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
        glColorMask(color_mask[0], color_mask[1], color_mask[2], color_mask[3]);
        glDepthMask(depth_mask);
        glDepthFunc(depth_func);
        glClearDepthf(clear_depth);
        if (depth_test) glEnable(GL_DEPTH_TEST); else glDisable(GL_DEPTH_TEST);
        if (blend) glEnable(GL_BLEND); else glDisable(GL_BLEND);
        if (cull) glEnable(GL_CULL_FACE); else glDisable(GL_CULL_FACE);
        if (scissor) glEnable(GL_SCISSOR_TEST); else glDisable(GL_SCISSOR_TEST);
        glActiveTexture(GL_TEXTURE4);
        glBindTexture(GL_TEXTURE_2D, texture);
        glActiveTexture(active_texture);
        return !m_shadow_failed;
    }

    void do_render(const libvgcode::Mat4x4& view, const libvgcode::Mat4x4& proj) {
        emscripten_webgl_make_context_current(m_ctx);

        libvgcode::Mat4x4 light_vp{};
        const bool shadows = render_shadows(light_vp);
        libvgcode::Vec3 eye_light{};
        for (int row = 0; row < 3; ++row)
            eye_light[row] = view[row] * LIGHT_DIRECTION[0] + view[4 + row] * LIGHT_DIRECTION[1] + view[8 + row] * LIGHT_DIRECTION[2];
        m_viewer.set_light_top_dir(eye_light);
        m_viewer.set_enhanced_lighting(m_lighting_enabled);
        m_viewer.set_shadow_map(4, light_vp, shadows ? 0.65f : 0.0f, m_shadow_size > 0 ? 1.0f / m_shadow_size : 0.0f);
        GLint active_texture, texture;
        glGetIntegerv(GL_ACTIVE_TEXTURE, &active_texture);
        glActiveTexture(GL_TEXTURE4);
        glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);
        glBindTexture(GL_TEXTURE_2D, m_shadow_texture);
        glActiveTexture(active_texture);

        glViewport(0, 0, m_width, m_height);
        if (m_light_theme) glClearColor(0.91f, 0.92f, 0.93f, 1.0f);
        else glClearColor(0.13f, 0.14f, 0.16f, 1.0f);
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
            m_bed.render(mvp, 1.0f, light_vp, shadows ? 0.30f : 0.0f);
            m_viewer.render(view, proj);
        }
        glActiveTexture(GL_TEXTURE4);
        glBindTexture(GL_TEXTURE_2D, texture);
        glActiveTexture(active_texture);
    }

    libvgcode::Viewer m_viewer;
    libvgcode::AABox m_extrusion_bounds{};
    bool m_extrusion_bounds_valid = false;
    BedRenderer m_bed;
    bool m_light_theme = false;
    bool m_low_quality = false;
    static constexpr libvgcode::Vec3 LIGHT_DIRECTION{-0.4574957f, 0.4574957f, 0.7624929f};
    bool m_shadows_enabled = true;
    bool m_lighting_enabled = true;
    bool m_shadow_failed = false;
    GLuint m_shadow_fbo = 0;
    GLuint m_shadow_texture = 0;
    int m_shadow_size = 0;
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
        .function("clearGcode", &OrcaPreview::clearGcode)
        .function("setToolColors", &OrcaPreview::setToolColors)
        .function("setLayerRange", &OrcaPreview::setLayerRange)
        .function("setMove", &OrcaPreview::setMove)
        .function("getMoveRange", &OrcaPreview::getMoveRange)
        .function("getMoveGcodeLine", &OrcaPreview::getMoveGcodeLine)
        .function("getMoveInfo", &OrcaPreview::getMoveInfo)
        .function("getLayersZs", &OrcaPreview::getLayersZs)
        .function("getLayerZ", &OrcaPreview::getLayerZ)
        .function("setViewType", &OrcaPreview::setViewType)
        .function("getLegendData", &OrcaPreview::getLegendData)
        .function("toggleExtrusionRole", &OrcaPreview::toggleExtrusionRole)
        .function("setExtrusionRoleVisible", &OrcaPreview::setExtrusionRoleVisible)
        .function("toggleOption", &OrcaPreview::toggleOption)
        .function("setOptionVisible", &OrcaPreview::setOptionVisible)
        .function("setLightTheme", &OrcaPreview::setLightTheme)
        .function("setLowQuality", &OrcaPreview::setLowQuality)
        .function("setShadowsEnabled", &OrcaPreview::setShadowsEnabled)
        .function("setLightingEnabled", &OrcaPreview::setLightingEnabled)
        .function("setClippingPlane", &OrcaPreview::setClippingPlane)
        .function("setBed", &OrcaPreview::setBed)
        .function("setBedPolygon", &OrcaPreview::setBedPolygon)
        .function("getBedPolygon", &OrcaPreview::getBedPolygon)
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
        .function("getRenderMemoryUsage", &OrcaPreview::getRenderMemoryUsage)
        ;
}

int main() {
    return 0;
}
