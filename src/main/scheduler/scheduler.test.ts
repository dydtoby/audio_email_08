import schedule = require('node-schedule');
const { scheduleJob, cancelJob } = require('./cronScheduler');

jest.mock('node-schedule', () => {
    return {
        RecurrenceRule: jest.fn().mockImplementation(() => ({})),
        scheduleJob: jest.fn().mockReturnValue({ cancel: jest.fn() })
    };
});

describe('cronScheduler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should schedule a job with the correct RecurrenceRule', () => {
        const taskTime = { hour: 10, minute: 30, second: 0, timezone: 'Europe/London' };
        const mockTask = jest.fn();

        const job = scheduleJob(taskTime, mockTask);

        expect(schedule.RecurrenceRule).toHaveBeenCalledTimes(1);

        const MockRule = schedule.RecurrenceRule as jest.Mock;
        const result = MockRule.mock.results[0];
        expect(result).toBeDefined();

        const ruleInstance = result?.value as any;
        expect(ruleInstance.hour).toBe(10);
        expect(ruleInstance.minute).toBe(30);
        expect(ruleInstance.second).toBe(0);
        expect(ruleInstance.tz).toBe('Europe/London');

        expect(schedule.scheduleJob).toHaveBeenCalledWith(ruleInstance, mockTask);
        expect(job).toBeDefined();
        expect(job.cancel).toBeDefined();
    });

    it('should cancel a job successfully', () => {
        const mockJob = { cancel: jest.fn() } as any;

        cancelJob(mockJob);

        expect(mockJob.cancel).toHaveBeenCalledTimes(1);
    });
});
