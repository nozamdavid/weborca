#pragma once

#include <memory>
#include <string>

class Engine {
public:
    Engine();
    ~Engine();

    int submit(const std::string& op, const std::string& argsJson);
    std::string poll(int jobId);
    std::string progress();
    void cancel();

private:
    class Impl;
    std::unique_ptr<Impl> m_impl;
};
