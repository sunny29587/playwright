import { GoogleGenAI } from '@google/genai';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the path to .env file
const envPath = resolve(__dirname, '../.env');

console.log('Current directory:', __dirname);
console.log('Env file path:', envPath);

// Load .env with the resolved path
const result = dotenv.config({
  path: envPath,
  debug: true // Enable debug mode
});

console.log('Environment variables:', {
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
});

if (result.error) {
  console.error('Error loading .env file:', result.error);
  process.exit(1);
}

// Validate environment variable with more detailed error
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('Environment variables loaded:', process.env);
  throw new Error(`GOOGLE_API_KEY environment variable is not set. 
    Check if .env file exists at: ${envPath}
    And contains: GOOGLE_API_KEY=your-key-here`);
}

const ai = new GoogleGenAI({
  apiKey,
});

//======================================================

const execPromise = util.promisify(exec);
//const BASE_FILENAME = 'google_navigation'
const TESTDIR = path.resolve(__dirname, '../tests');
const OUTPUT_FILES = {
  PLAYWRIGHT: 'google_navigation.playwright.spec.ts',
  TESTCAFE: 'google_navigation.testcafe.ts',
  SELENIUM: 'google_navigation.selenium.spec.cjs'
};
const MAX_ATTEMPTS = 3;

// Function to get project structure context
function getProjectContext() {
  const projectFiles = [];

  function readDirRecursive(dir) {
    const items = readdirSync(dir, { withFileTypes: true });

    items.forEach(item => {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory() && !['node_modules', '.git'].includes(item.name)) {
        projectFiles.push(`📁 ${fullPath}`);
        readDirRecursive(fullPath);
      } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.js'))) {
        projectFiles.push(`📄 ${fullPath}`);
      }
    });
  }

  readDirRecursive(path.resolve(__dirname, '../'));
  return projectFiles.join('\n');
}

if (!existsSync(TESTDIR)) {
  mkdirSync(TESTDIR, { recursive: true });
}

const basePrompts = {
  PLAYWRIGHT: `Generate an accurate and fully executable Playwright test script in TypeScript.
Project Structure Context:
${getProjectContext()}

Current working directory: ${TESTDIR}
Target output file: ${OUTPUT_FILES.PLAYWRIGHT}

Include meaningful inline comments to explain each step. The output should be code-only, with no explanation or description outside the code block. Also console log each test step.`,
  TESTCAFE: `Generate an accurate and fully executable in CLI TestCafe test script in TypeScript.
Project Structure Context:
${getProjectContext()}

Current working directory: ${TESTDIR}
Target output file: ${OUTPUT_FILES.TESTCAFE}

Include meaningful inline comments to explain each step. The output should be code-only, with no explanation or description outside the code block. Also console log each test step.

also handle invisible elements and wait for them to be visible before interacting with them. handle unwanted popups and alerts gracefully.`,
SELENIUM: `Generate an accurate and fully executable Selenium WebDriver test script in JavaScript .
Project Structure Context:
${getProjectContext()}

Current working directory: ${TESTDIR}
Target output file: ${OUTPUT_FILES.SELENIUM}

Use Selenium WebDriver with JavaScript (CommonJS). Use require() instead of import. The test should use mocha describe and it functions.

Include meaningful inline comments to explain each step. The output should be code-only, with no explanation or description outside the code block. Also console log each test step.
Handle popups and alerts gracefully. Wait for elements to be visible before interacting with them.`
};

const userPrompt = `Navigate to https://www.webpagetest.org/ and handle any popups, 
wait for 2 seconds,
then navigate to thoughtworks.com and wait for 2 seconds,
then close the browser`;

async function generateTestScript(framework, errorContext) {
  const basePrompt = basePrompts[framework];
  const promptText = errorContext
    ? `${basePrompt}\n\nThe previous attempt failed with the following error:\n${errorContext}\nPlease correct the code and regenerate.`
    : basePrompt;

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }],
      },
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    config: {
      tools: [{ codeExecution: {} }],
    },
  });

  const parts = response?.candidates?.[0]?.content?.parts || [];
  let output = '';

  parts.forEach((part) => {
    if (part.text) {
      const cleaned = part.text.split('\n').filter(line => !line.includes('```')).join('\n');
      output += `${cleaned}\n`;
    } else if (part.executableCode?.code) {
      output += `${part.executableCode.code}\n`;
    }
  });

  return `// *** This code is generated by AI Agent ***\n\n${output}`;
}

async function executeTestScript(framework, filePath) {
  try {
    let command, cwd;
    const absolutePath = path.resolve(TESTDIR, path.basename(filePath));

    switch (framework) {
      case 'PLAYWRIGHT':
        command = `npx playwright test ${path.basename(filePath)}`;
        cwd = TESTDIR;
        break;
      case 'TESTCAFE':
        command = `npx testcafe chrome ${path.basename(filePath)}`;
        cwd = TESTDIR;
        break;
      case 'SELENIUM':
        command = `npx mocha "${absolutePath}"`;
        break;
      default:
        throw new Error(`Unknown framework: ${framework}`);
    }
    const { stdout, stderr } = await execPromise(`cd ${TESTDIR} && ${command}`);
    return { success: true, output: stdout };
  } catch (err) {
    return { success: false, output: err.stderr || err.message };
  }
}

async function generateAndDebug(framework) {
  let attempt = 0;
  let success = false;
  let lastError = '';
  const outputPath = path.join(TESTDIR, OUTPUT_FILES[framework]);

console.log(`\n🔧 Generating tests for ${framework}...`);

  while (attempt < MAX_ATTEMPTS && !success) {
    console.log(`🧠 Executing [${framework}] test:: Attempt #${attempt + 1}...`);

    const code = await generateTestScript(framework, lastError);
    writeFileSync(outputPath, code);

    const result = await executeTestScript(framework, outputPath);
    success = result.success;
    lastError = result.output;

    if (success) {
      console.log(`✅ [${framework}] Test script executed successfully.`);
      console.log(result.output);
    } else {
      console.warn(`❌ [${framework}] Script failed on attempt ${attempt + 1}. Error:\n${lastError}`);
    }

    attempt++;
  }

  if (!success) {
    console.error(`💥 [${framework}] All ${MAX_ATTEMPTS} attempts failed. Last error:\n${lastError}`);
  }
}

async function generateAll() {
  await generateAndDebug('PLAYWRIGHT');
  await generateAndDebug('TESTCAFE');
  await generateAndDebug('SELENIUM');
}


// First, install required dependencies
const dependencies = {
  PLAYWRIGHT: ['@playwright/test', 'playwright'],
  SELENIUM: [
    'selenium-webdriver',
    '@types/selenium-webdriver',
    'mocha',
    '@types/mocha',
    'chai',
    '@types/chai',
    'ts-mocha',
    'typescript'
  ],
  TESTCAFE: ['testcafe'],
  APPIUM: ['webdriverio', 'appium', '@wdio/appium-service']
};

async function installDependencies() {
  console.log('📦 Installing required dependencies...');
  for (const [framework, deps] of Object.entries(dependencies)) {
    try {
      console.log(`Installing ${framework} dependencies...`);
      await execPromise(`npm install -D ${deps.join(' ')}`);
    } catch (error) {
      console.error(`Failed to install ${framework} dependencies:`, error);
    }
  }
}

async function createTsConfig() {
  const tsConfigPath = path.join(TESTDIR, '..', 'tsconfig.json');
  if (!existsSync(tsConfigPath)) {
    const tsConfig = {
      "compilerOptions": {
        "target": "ES2020",
        "module": "commonjs",
        "lib": ["es2020", "DOM"],
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "moduleResolution": "node",
        "resolveJsonModule": true,
        "allowJs": true,
        "types": ["node", "mocha", "selenium-webdriver"],
        "outDir": "./dist"
      },
      "include": ["tests/**/*"],
      "exclude": ["node_modules"]
    };

    writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2));
    console.log('Created tsconfig.json');
  }
}

async function createMochaConfig() {
  const mochaConfigPath = path.join(TESTDIR, '..', '.mocharc.json');
  if (!existsSync(mochaConfigPath)) {
    const mochaConfig = {
      "extension": ["ts"],
      "spec": "tests/**/*.spec.ts",
      "require": "ts-node/register",
      "timeout": 60000
    };

    writeFileSync(mochaConfigPath, JSON.stringify(mochaConfig, null, 2));
    console.log('Created .mocharc.json');
  }
}



//generateAll();

// Main execution
(async () => {
  await installDependencies();
  await createTsConfig();
  await createMochaConfig();
  await generateAll();
})();
