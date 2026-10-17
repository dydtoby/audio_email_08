const electron = require('electron');
const { dialog } = electron;
const electronStore = require('electron-store');
const Store = electronStore.default || electronStore;

const cron = require('./cronScheduler');
const { scheduleJob } = cron;

const store = new Store({ clearInvalidConfig: true });
let currentJobs = [];
let taskCallback = null;

const DAY_MAP = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };

function setScheduledCallback(callback) {
  taskCallback = callback;
}

function getNextOccurrence(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next < now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function initializeScheduler() {
  const savedTasks = store.get('tasks', []);

  currentJobs.forEach(job => {
    if (job) job.cancel();
  });
  currentJobs = [];

  savedTasks.forEach(task => {
    if (task.active === false) return; // Skip inactive tasks

    const job = scheduleJob({
      hour: task.hour,
      minute: task.minute,
      second: 0,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayOfWeek: task.dayOfWeek
    }, () => {
      const runTime = new Date().toLocaleString();
      if (taskCallback) {
        taskCallback({ mode: task.mode || 'Unread Only' });
      } else {
        dialog.showMessageBox({ message: `Scheduled Task executed for ${task.hour}:${task.minute}. Last triggered at: ${runTime}` });
      }

      const currentTasks = store.get('tasks', []);
      const taskIndex = currentTasks.findIndex(t => t.id === task.id);
      if (taskIndex !== -1) {
        currentTasks[taskIndex].lastTriggered = runTime;
        store.set('tasks', currentTasks);
      }
    });

    if (job) currentJobs.push(job);
  });
}

function getSavedTasks() {
  return store.get('tasks', []);
}

function handleScheduleTask(taskInput) {
  let tasks = Array.isArray(taskInput) ? taskInput : [taskInput];

  const formattedTasks = tasks.map(taskInputItem => {
    let hour = 0;
    let minute = 0;
    let mode = 'Unread Only';
    let dayOfWeek = undefined;
    let id = Date.now() + Math.random();

    if (typeof taskInputItem === 'string') {
      const parts = taskInputItem.split(':');
      hour = Number(parts[0]);
      minute = Number(parts[1]);
      return { id, name: 'Scheduled Reading', time: taskInputItem, active: true, days: [], hour, minute, dayOfWeek, mode };
    } else {
      let parts = ['09', '00'];
      if (taskInputItem.time) {
        parts = taskInputItem.time.split(':');
      } else if (taskInputItem.hour !== undefined && taskInputItem.minute !== undefined) {
        parts = [String(taskInputItem.hour).padStart(2, '0'), String(taskInputItem.minute).padStart(2, '0')];
      }
      
      hour = Number(parts[0]);
      minute = Number(parts[1]);
      const timeStr = taskInputItem.time || `${parts[0]}:${parts[1]}`;
      mode = taskInputItem.mode || 'Unread Only';
      if (taskInputItem.days && Array.isArray(taskInputItem.days) && taskInputItem.days.length > 0) {
        dayOfWeek = taskInputItem.days.map((d) => DAY_MAP[d]).filter((d) => d !== undefined);
      }
      id = taskInputItem.id || id;
      return { 
        ...taskInputItem, 
        name: taskInputItem.name || 'Scheduled Reading',
        time: timeStr, 
        id, 
        hour, 
        minute, 
        dayOfWeek, 
        mode 
      };
    }
  });

  store.set('tasks', formattedTasks);
  initializeScheduler();
}

function clearScheduleTask() {
  currentJobs.forEach(job => {
    if (job) job.cancel();
  });
  currentJobs = [];
  store.set('tasks', []);
}

module.exports = { initializeScheduler, getSavedTasks, handleScheduleTask, clearScheduleTask, setScheduledCallback };
