require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const student = {
  name: 'Radhe',
  email: 'shyamradhe494949@gmail.com',
  rollNumber: '229999',
  enrollmentNumber: 'GL20229999',
  branch: 'CSE',
  semester: '5',
  section: 'A',
  batch: '2022',
  role: 'STUDENT',
  status: 'ACTIVE',
  isVerified: true
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const existing = await User.findOne({ email: student.email.toLowerCase() });
  if (existing) {
    console.log('Ye email pehle se registered hai:', existing.email, '| role:', existing.role);
  } else {
    const created = await User.create(student);
    console.log('Student add ho gaya:', created.email);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});