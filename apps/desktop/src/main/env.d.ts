// vite `?raw` import（system-prompt.md）的类型声明
declare module '*.md?raw' {
  const content: string;
  export default content;
}
