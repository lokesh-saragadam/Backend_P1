const { z } = require("zod");
const OpenAI = require("openai");
const dotenv = require("dotenv").config();
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Or compatible provider API key
});

// ==========================================
// 1. TAXONOMY DEFINITIONS (Strict Enums)
// ==========================================
const PATTERNS = [
  "Two Pointers",
  "Fast and Slow Pointers (Floyd's Cycle Detection)",
  "Sliding Window",
  "Prefix Sum",
  "Difference Array (Range Updates)",
  "Cyclic Sort",
  "Dutch National Flag (3-Way Partitioning)",
  "Stack",
  "Monotonic Stack",
  "Monotonic Queue / Deque",
  "Heap / Top 'K' Elements",
  "Two Heaps (Running Median)",
  "Binary Search (Search Space & Search on Answer)",
  "Quickselect (Kth Order Statistic)",
  "Merge Intervals",
  "Line Sweep",
  "Depth-First Search (DFS)",
  "Breadth-First Search (BFS)",
  "Multi-Source BFS",
  "Topological Sort (Kahn's Algorithm)",
  "Union Find (Disjoint Set Union)",
  "Shortest Path (Dijkstra / 0-1 BFS)",
  "Trie Search & Prefix Matching",
  "Segment Tree / Fenwick Tree (Range Queries)",
  "Hash Map / Frequency Counting",
  "Kadane's Algorithm (Maximum Subarray)",
  "Backtracking",
  "Dynamic Programming",
  "Bit Manipulation & Bitmasking",
  "Divide and Conquer",
];

const CONCEPTS = [
  "Frequency Counting",
  "Prefix Sum",
  "Prefix XOR (Cancellation Properties)",
  "Parity (Odd/Even Properties)",
  "Modulo Arithmetic Properties",
  "Majority Element (Boyer-Moore Property)",
  "Boundary Detection",
  "Sliding Window Invariant",
  "Interval Overlap & Intersection",
  "Subarray/Substring Combinatorics",
  "Palindromic Mirroring",
  "Lexicographical Ordering",
  "Next Greater Element",
  "Next Smaller Element",
  "Deferred Processing (Lazy Evaluation)",
  "Bracket Matching & Nesting Depth",
  "Connected Components",
  "Shortest Path",
  "Cycle Detection",
  "Indegree / Outdegree (Dependency Tracking)",
  "Lowest Common Ancestor (LCA)",
  "Graph Bipartiteness (Two-Coloring)",
  "Tree Diameter (Longest Path)",
  "Leaf Pruning (Topological Peeling)",
  "Matrix Traversal & Direction Vectors",
  "Search Space Reduction",
  "Monotonic Predicate (True/False Boundary)",
  "Pivot Partitioning",
  "Kth Extremum (Min/Max Boundary)",
  "Prefix Matching / Autocompletion",
  "Overlapping Subproblems",
  "Optimal Substructure",
  "State Transition",
  "State Memorization (Memoization)",
  "Local vs. Global Optimum",
  "Range Contribution",
  "Knapsack Property (Choose vs. Skip)",
  "Inclusion-Exclusion Principle",
  "Bitwise State Encoding (Bitmasking)",
  "Two's Complement (Lowest Set Bit)",
];

const PatternEnum = z.enum(PATTERNS);
const ConceptEnum = z.enum(CONCEPTS);

// ==========================================
// 2. ZOD OUTPUT SCHEMA
// ==========================================
const ProblemMetadataSchema = z.object({
  patterns: z.array(
    z.object({
      name: PatternEnum.describe("Must be an exact match from the PATTERNS taxonomy"),
      confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
    })
  ).describe("Applicable algorithmic execution patterns"),

  concepts: z.array(
    z.object({
      name: ConceptEnum.describe("Must be an exact match from the CONCEPTS taxonomy"),
      confidence: z.number().min(0).max(1).describe("Confidence score between 0.0 and 1.0"),
    })
  ).describe("Core theoretical concepts or invariant properties"),

  prerequisites: z.array(
    z.object({
      name: ConceptEnum.describe("Concepts the user must know prior to solving this problem"),
      confidence: z.number().min(0).max(1),
    })
  ).describe("Foundational prerequisite concepts"),

  learningObjectives: z
    .array(z.string().describe("Clear takeaway skill acquired from this problem"))
    .max(3),
});

// ==========================================
// 3. PROMPT GENERATORS
// ==========================================
function buildSystemPrompt() {
  return `You are a DSA problem classification system.

Your task is to classify programming problems into a predefined DSA taxonomy.

You MUST only select patterns and concepts from the provided taxonomy.
Do not invent new categories.
You must return structured JSON matching the provided schema.

PATTERNS:
${PATTERNS.map((p) => `- ${p}`).join("\n")}

CONCEPTS:
${CONCEPTS.map((c) => `- ${c}`).join("\n")}

PREREQUISITE CONCEPTS:
${CONCEPTS.map((c) => `- ${c}`).join("\n")}
`;
}

function buildUserPrompt(problem) {
  return `USER TASK

Classify the following problem.

PROBLEM

Title:
${problem.problemtitle || "N/A"}

Difficulty:
${problem.difficulty || "N/A"}

Tags:
${Array.isArray(problem.tags) ? problem.tags.join(", ") : problem.tags || "N/A"}

Description:
${problem.description || "No description provided."}

Constraints:
${problem.constraints || "Refer to description."}
`;
}

// ==========================================
// 4. LLM API CALLER (Single Problem)
// ==========================================
async function classifySingleProblem(problem) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Or your preferred model
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(problem) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ProblemMetadataResponse",
          schema: {
            type: "object",
            properties: {
              patterns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", enum: PATTERNS },
                    confidence: { type: "number" },
                  },
                  required: ["name", "confidence"],
                  additionalProperties: false,
                },
              },
              concepts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", enum: CONCEPTS },
                    confidence: { type: "number" },
                  },
                  required: ["name", "confidence"],
                  additionalProperties: false,
                },
              },
              prerequisites: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", enum: CONCEPTS },
                    confidence: { type: "number" },
                  },
                  required: ["name", "confidence"],
                  additionalProperties: false,
                },
              },
              learningObjectives: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["patterns", "concepts", "prerequisites", "learningObjectives"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
      temperature: 0.1,
    });

    const parsedJson = JSON.parse(response.choices[0].message.content);
    
    // Validate with Zod before returning
    const validatedData = ProblemMetadataSchema.parse(parsedJson);
    return {
      problemid: problem.problemid,
      metadata: validatedData,
      success: true,
    };
  } catch (error) {
    console.error(`Failed to classify problem ID ${problem.problemid}:`, error.message);
    return {
      problemid: problem.problemid,
      error: error.message,
      success: false,
    };
  }
}

// ==========================================
// 5. BATCH PROCESSING PIPELINE
// ==========================================
/**
 * Splits array into chunks and processes each batch concurrently.
 * @param {Array} items - List of problems
 * @param {number} batchSize - Number of parallel LLM calls per batch (e.g., 5 to 10)
 * @param {number} delayBetweenBatchesMs - Delay to avoid rate limits
 */
async function batchClassifyProblems(problems, batchSize = 5, delayBetweenBatchesMs = 1000) {
  const allResults = [];

  for (let i = 0; i < problems.length; i += batchSize) {
    const chunk = problems.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(problems.length / batchSize)} (${chunk.length} problems)...`);

    // Execute API calls in parallel for current batch
    const batchPromises = chunk.map((problem) => classifySingleProblem(problem));
    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        allResults.push(result.value);

        // TODO: Save result.value.metadata to your database (e.g. Prisma)
        // await prisma.problemMetadata.upsert(...)
      } else {
        allResults.push({ error: result.reason, success: false });
      }
    }

    // Rate-limiting delay before next batch
    if (i + batchSize < problems.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatchesMs));
    }
  }

  return allResults;
}

// ==========================================
// 6. MAIN EXECUTION / SKELETON RUNNER
// ==========================================
async function main() {
  // TODO: Fetch unclassified problems from your database using Prisma
  // const unclassifiedProblems = await prisma.problem.findMany({
  //   where: { description: { not: null } },
  //   take: 50
  // });

  // Example placeholder payload
  const sampleProblems = [
    {
      problemid: 84,
      problemtitle: "Largest Rectangle in Histogram",
      difficulty: "Hard",
      tags: ["Array", "Stack", "Monotonic Stack"],
      description: "Given an array of integers heights representing the histogram's bar height where the width of each bar is 1, return the area of the largest rectangle in the histogram.",
      constraints: "1 <= heights.length <= 10^5, 0 <= heights[i] <= 10^4",
    },
  ];

  console.log("Starting classification job...");
  const results = await batchClassifyProblems(sampleProblems, 5, 500);
  console.log("Classification completed. Sample output:\n", JSON.stringify(results, null, 2));
}

// Uncomment to run directly:
// main();

module.exports = {
  PATTERNS,
  CONCEPTS,
  ProblemMetadataSchema,
  buildSystemPrompt,
  buildUserPrompt,
  classifySingleProblem,
  batchClassifyProblems,
};