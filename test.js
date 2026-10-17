const tasksInput = [{
  name: 'Test', time: '10:00', days: ['Mon'], mode: 'Unread Only', active: true
}];

const DAY_MAP = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };

const formattedTasks = tasksInput.map(taskInputItem => {
      const parts = (taskInputItem.time || '').split(':');
      const hour = Number(parts[0]) || 0;
      const minute = Number(parts[1]) || 0;
      
      let dayOfWeek = undefined;
      if (taskInputItem.days && Array.isArray(taskInputItem.days) && taskInputItem.days.length > 0) {
        dayOfWeek = taskInputItem.days.map(d => DAY_MAP[d]).filter(d => d !== undefined);
      }
      
      return { 
        ...taskInputItem, 
        id: taskInputItem.id || Date.now() + Math.random(),
        hour, 
        minute, 
        dayOfWeek,
        active: taskInputItem.active !== false
      };
});

console.log(formattedTasks);
