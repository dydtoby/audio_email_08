import electron = require('electron');
import electronStore = require('electron-store');
import cron = require('./cronScheduler');
import schedulerManager = require('./schedulerManager');

// Mock out dependencies
jest.mock('electron', () => ({
  dialog: { showMessageBox: jest.fn() }
}));

jest.mock('electron-store', () => {
  let internalStore: any = { tasks: [] };
  return jest.fn().mockImplementation(() => {
    return {
      get: jest.fn((key: string, _default: any) => internalStore[key] || _default),
      set: jest.fn((key: string, value: any) => { internalStore[key] = value }),
      delete: jest.fn((key: string) => { delete internalStore[key] }),
      _mockReset: () => { internalStore = { tasks: [] } },
      _mockGetStore: () => internalStore
    };
  });
});

jest.mock('./cronScheduler', () => ({
  scheduleJob: jest.fn().mockReturnValue({ cancel: jest.fn() })
}));

describe('schedulerManager', () => {
  let mockStoreInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // We instantiate electronStore manually to reset its mock state
    const Store = (electronStore as any).default || electronStore;
    mockStoreInstance = new Store();
    mockStoreInstance._mockReset();
  });

  it('should successfully schedule a new task and persist it to electron-store', () => {
    schedulerManager.handleScheduleTask('14:30');
    
    // Test that the mock cronScheduler was invoked
    expect(cron.scheduleJob).toHaveBeenCalledTimes(1);
    
    // Test that the task was successfully added to store
    const savedTasks = mockStoreInstance.get('tasks');
    expect(savedTasks.length).toBe(1);
    expect(savedTasks[0].hour).toBe(14);
    expect(savedTasks[0].minute).toBe(30);
    expect(savedTasks[0].nextRunTime).toBeDefined();
  });

  it('should return saved tasks using getSavedTasks', () => {
    mockStoreInstance.set('tasks', [{ hour: 9, minute: 0, nextRunTime: 12345 }]);
    
    const returned = schedulerManager.getSavedTasks();
    expect(returned.length).toBe(1);
    expect(returned[0].hour).toBe(9);
  });

  it('should clear all schedules when clearScheduleTask is invoked', () => {
    // Schedule one first to assign currentJob
    schedulerManager.handleScheduleTask('16:45');
    expect(mockStoreInstance.get('tasks').length).toBe(1);

    // Now clear it
    schedulerManager.clearScheduleTask();

    // Verify dialog was shown
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Schedule Cleared'
    }));

    // Verify tasks array was wiped correctly
    expect(mockStoreInstance.get('tasks').length).toBe(0);
  });
});
