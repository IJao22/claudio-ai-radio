export default {
  appId: "com.claudio.localradio",
  productName: "Claudio",
  artifactName: "Claudio-${version}-${arch}.${ext}",
  directories: {
    output: "output/desktop"
  },
  files: [
    "apps/desktop/**/*",
    "package.json"
  ],
  extraResources: [
    {
      from: "tmp/desktop-bundle/app-bundle",
      to: "app-bundle",
      filter: [
        "**/*",
        "!node_modules",
        "!node_modules/**/*"
      ]
    },
    {
      from: "tmp/desktop-bundle/app-bundle/node_modules",
      to: "app-bundle/node_modules"
    }
  ],
  asarUnpack: [
    "app-bundle/**/*"
  ],
  win: {
    signAndEditExecutable: false,
    target: [
      {
        target: "zip",
        arch: [
          "x64"
        ]
      }
    ]
  }
};
