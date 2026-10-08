require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

// Sirf test Excel wale students: enrollment GL2022xxxx aur email @glbitm.ac.in
const filter = {
  role: 'STUDENT',
  enrollmentNumber: /^GL2022\d{4}$/,
  email: /@glbitm\.ac\.in$/
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const count = await User.countDocuments(filter);
  console.log(`Matching test students: ${count}`);

  if (process.argv[2] === '--confirm') {
    const res = await User.deleteMany(filter);
    console.log(`Deleted: ${res.deletedCount}`);
  } else {
    console.log('Dry run only. Delete karne ke liye: node delete_test_students.js --confirm');
  }
  await mongoose.disconnect();
})();