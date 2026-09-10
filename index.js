const GoogleCloudAutomation = require('./models/automate');
const CONFIG = require('./models/config');
const fs = require('fs');
const path = require('path');

// ==================== EXECUTION ==================== 
if (require.main === module) {
  if (!CONFIG.projectId || CONFIG.projectId === 'your-project-id') {
    console.error(' Please set your project ID in CONFIG');
    process.exit(1);
  }
  
  let automation = null;
  
  const cleanup = async () => {
    console.log('\n  Shutting down...');
    if (automation && automation.browser) {
      await automation.browser.close();
    }
    process.exit(0);
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  automation = new GoogleCloudAutomation(CONFIG);
  
  automation.run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n Process failed:', error.message);
      process.exit(1);
    });
}