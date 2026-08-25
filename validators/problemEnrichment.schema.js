const { z } = require("zod");

const ProblemMetadataSchema = z.object({
    patterns: z.array(
        z.object({
            name: z.string().describe("The execution strategy, e.g., 'Sliding Window' or 'Binary Search'"),
            confidence: z.number().min(0).max(1).describe("Confidence that this pattern is required, from 0.0 to 1.0")
        })
    ).describe("The structural patterns required to solve the problem"),

    concepts: z.array(
        z.object({
            name: z.string().describe("The underlying mathematical or logical property, e.g., 'Monotonic Predicate'"),
            confidence: z.number().min(0).max(1)
        })
    ).describe("The theoretical concepts or 'Aha!' moments required"),

    prerequisites: z.array(
        z.object({
            name: z.string().describe("Topics the user must know before attempting this problem"),
            confidence: z.number().min(0).max(1)
        })
    ),

    learningObjectives: z.array(
        z.string().describe("Clear, action-oriented statements of what the user will learn")
    ).max(3).describe("Maximum of 3 core takeaways from this problem")
});

module.exports={ProblemMetadataSchema};