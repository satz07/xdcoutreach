/** Replaced per recipient at send time with their signed meeting-form link (services/leads.js). */
const MEETING_PLACEHOLDER = '{{MEETING_URL}}';

const DEFAULT_MEETING_FORM_LABEL = 'Request a meeting';

/**
 * The lead-form button is an optional extra, off unless the template opts in.
 * Existing "Schedule a meeting" buttons (mailto / Calendly) are never replaced.
 */
function meetingFormEnabled(value) {
  return value === true || value === 'true';
}

module.exports = { MEETING_PLACEHOLDER, DEFAULT_MEETING_FORM_LABEL, meetingFormEnabled };
