module.exports = {
  apps: [
    {
      name: 'app',
      script: './src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
    },
  ],
};