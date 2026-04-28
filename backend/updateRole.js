require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  await mongoose.connection.db.collection('teachers').updateOne({email:'admin@teacher.com'}, {$set:{role:'ADMIN'}});
  console.log('Role updated');
  process.exit(0);
});
