// The ggwave package does not ship TypeScript types, so we describe the little we use.
declare module "ggwave" {
  const factory: () => Promise<any>;
  export default factory;
}
