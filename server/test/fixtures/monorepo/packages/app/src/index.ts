const { APP_KEY, OTHER_KEY: renamed, ...rest } = process.env;
const port = process.env['APP_PORT'];
console.log(APP_KEY, renamed, rest, port);
