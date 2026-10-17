const schedule = require('node-schedule');

/**
 * @param {object} taskTime
 * @param {function} task
 * @returns {object}
 */
function scheduleJob(taskTime, task) {
    const rule = new schedule.RecurrenceRule();
    rule.hour = taskTime.hour;
    rule.minute = taskTime.minute;
    rule.second = taskTime.second;
    rule.tz = taskTime.timezone;
    if (taskTime.dayOfWeek) {
        rule.dayOfWeek = taskTime.dayOfWeek;
    }

    const job = schedule.scheduleJob(rule, task);
    return job;
}

function cancelJob(job) {
    job.cancel();
}

module.exports = { scheduleJob, cancelJob };
