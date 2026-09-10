const path = require('path');

module.exports = {
  projectId: 'centering-valvs-401309-m2',
  emailsToAdd: [
    'xyz@gmail.com', 
  ],
  profileDir: path.join(__dirname, 'chrome-profile'),
  timeout: 30000,
  debug: true
};

