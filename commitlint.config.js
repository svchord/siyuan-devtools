export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 显式固定为 100：中文标题信息密度高，不能依赖上游默认值。
    'header-max-length': [2, 'always', 100],
    // 中文正文一行信息量大，按列宽硬折行只会制造噪音，因此关闭行宽限制。
    'body-max-line-length': [0],
    // 中文主题没有大小写概念，这条规则只会误报。
    'subject-case': [0],
  },
  ignores: [
    // 以下提交不是人写的，改不了也不该改；放行避免历史里一旦存在就永远 push 不上去。
    (message) => /^Merge (pull request|branch|remote-tracking)/.test(message),
    (message) => /^chore\((main|release)\): release /.test(message),
    (message) => /^Revert "/.test(message),
  ],
};
