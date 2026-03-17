// eslint.config.js
export default [
    {
        // This replaces .eslintignore
        ignores: ["dist/", "node_modules/"]
    },
    {
        files: ["src/**/*.js"],
        rules: {
            "no-unused-vars": "error",
            "semi": "warn"
        }
    }
];
