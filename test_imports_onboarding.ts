import * as Phosphor from "@phosphor-icons/react";

const keys = Object.keys(Phosphor);
console.log("Keys containing 'File':", keys.filter(k => k.includes("File") && !k.endsWith("Icon")));
