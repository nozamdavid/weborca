// Slicing status and warning forwarding, kept apart from PrintBase.cpp so that programs that only
// parse G-code (the wasm preview) do not link PrintBase's filename templating and PlaceholderParser.
#include "PrintBase.hpp"

#include <boost/format.hpp>
#include <boost/log/trivial.hpp>

namespace Slic3r
{

void PrintBase::status_update_warnings(int step, PrintStateBase::WarningLevel  warning_level,
    const std::string &message, const PrintObjectBase* print_object, PrintStateBase::SlicingNotificationType message_id)
{
    if (this->m_status_callback) {
        auto status = print_object ? SlicingStatus(*print_object, step, message, message_id, warning_level) : SlicingStatus(*this, step, message, message_id, warning_level);
        m_status_callback(status);
    }
    else if (! message.empty())
        BOOST_LOG_TRIVIAL(info) << __FUNCTION__ << boost::format(", Print warning: %1%\n")% message.c_str();
}

//BBS: add PrintObject id into slicing status
void PrintBase::status_update_warnings(int step, PrintStateBase::WarningLevel warning_level,
    const std::string& message, PrintObjectBase &object, PrintStateBase::SlicingNotificationType message_id)
{
    //BBS: add object it into slicing status
    if (this->m_status_callback) {
        m_status_callback(SlicingStatus(object, step, message, message_id, warning_level));
    }
    else if (!message.empty())
        BOOST_LOG_TRIVIAL(info) << __FUNCTION__ << boost::format(", PrintObject warning: %1%\n")% message.c_str();
}

void PrintObjectBase::status_update_warnings(PrintBase *print, int step, PrintStateBase::WarningLevel warning_level,
    const std::string &message, PrintStateBase::SlicingNotificationType message_id)
{
    print->status_update_warnings(step, warning_level, message, this, message_id);
}

} // namespace Slic3r
