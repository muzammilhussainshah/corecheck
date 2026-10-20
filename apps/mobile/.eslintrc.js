module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void promise` marks a deliberately un-awaited call.
    'no-void': ['warn', { allowAsStatement: true }],
  },
};
