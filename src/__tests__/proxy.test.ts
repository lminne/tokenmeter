/**
 * Tests for the monitor (Proxy) function
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { monitor } from "../instrumentation/proxy.js";
import { withCost } from "../client/withCost.js";

describe("Monitor (Proxy)", () => {
  describe("Basic Proxying", () => {
    it("should preserve object properties", () => {
      const client = {
        version: "1.0.0",
        config: { timeout: 5000 },
      };

      const monitored = monitor(client);

      expect(monitored.version).toBe("1.0.0");
      expect(monitored.config.timeout).toBe(5000);
    });

    it("should preserve function behavior", async () => {
      const client = {
        greet: (name: string) => `Hello, ${name}!`,
      };

      const monitored = monitor(client);
      const result = monitored.greet("World");

      expect(result).toBe("Hello, World!");
    });

    it("should handle async functions", async () => {
      const client = {
        fetchData: async () => {
          return { data: "test" };
        },
      };

      const monitored = monitor(client);
      const result = await monitored.fetchData();

      expect(result).toEqual({ data: "test" });
    });

    it("should handle nested objects", () => {
      const client = {
        chat: {
          completions: {
            create: async () => ({ id: "123" }),
          },
        },
      };

      const monitored = monitor(client);

      expect(monitored.chat).toBeDefined();
      expect(monitored.chat.completions).toBeDefined();
      expect(typeof monitored.chat.completions.create).toBe("function");
    });
  });

  describe("Provider Detection", () => {
    it("should detect OpenAI client structure", () => {
      const openaiLike = {
        chat: {
          completions: {
            create: async () => ({}),
          },
        },
      };

      // Should not throw - provider detection happens internally
      const monitored = monitor(openaiLike);
      expect(monitored.chat.completions.create).toBeDefined();
    });

    it("should detect Anthropic client structure", () => {
      const anthropicLike = {
        messages: {
          create: async () => ({}),
        },
      };

      const monitored = monitor(anthropicLike);
      expect(monitored.messages.create).toBeDefined();
    });

    it("should detect fal.ai client structure", () => {
      const falLike = {
        subscribe: async () => ({}),
      };

      const monitored = monitor(falLike);
      expect(monitored.subscribe).toBeDefined();
    });

    it("should detect @google/generative-ai GoogleGenerativeAI structure", () => {
      const googleGenAILike = {
        getGenerativeModel: () => ({
          generateContent: async () => ({}),
        }),
      };

      const monitored = monitor(googleGenAILike);
      expect(monitored.getGenerativeModel).toBeDefined();
    });

    it("should detect @google/generative-ai GenerativeModel structure", () => {
      const generativeModelLike = {
        generateContent: async () => ({}),
        generateContentStream: async () => ({}),
        model: "gemini-1.5-flash",
      };

      const monitored = monitor(generativeModelLike);
      expect(monitored.generateContent).toBeDefined();
    });

    it("should detect @google/genai GoogleGenAI structure", () => {
      const googleGenAINew = {
        models: {
          generateContent: async () => ({}),
          generateContentStream: async () => ({}),
        },
      };

      const monitored = monitor(googleGenAINew);
      expect(monitored.models.generateContent).toBeDefined();
    });

    it("should allow provider override", () => {
      const client = {
        call: async () => ({}),
      };

      // Should not throw with explicit provider
      const monitored = monitor(client, { provider: "custom" });
      expect(monitored.call).toBeDefined();
    });
  });

  describe("Options", () => {
    it("should accept custom name", () => {
      const client = {
        call: async () => ({}),
      };

      const monitored = monitor(client, { name: "my-client" });
      expect(monitored.call).toBeDefined();
    });

    it("should accept custom attributes", () => {
      const client = {
        call: async () => ({}),
      };

      const monitored = monitor(client, {
        attributes: { "custom.attr": "value" },
      });
      expect(monitored.call).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should propagate sync errors as rejected promises", async () => {
      const client = {
        failSync: () => {
          throw new Error("Sync error");
        },
      };

      const monitored = monitor(client);

      // All errors are returned as rejected promises for consistency with async APIs
      await expect(monitored.failSync()).rejects.toThrow("Sync error");
    });

    it("should propagate async errors", async () => {
      const client = {
        failAsync: async () => {
          throw new Error("Async error");
        },
      };

      const monitored = monitor(client);

      await expect(monitored.failAsync()).rejects.toThrow("Async error");
    });
  });

  describe("Return Value Handling", () => {
    it("should preserve return value types", async () => {
      const client = {
        getNumber: () => 42,
        getString: () => "hello",
        getArray: () => [1, 2, 3],
        getObject: () => ({ foo: "bar" }),
        getPromise: async () => "async result",
      };

      const monitored = monitor(client);

      expect(monitored.getNumber()).toBe(42);
      expect(monitored.getString()).toBe("hello");
      expect(monitored.getArray()).toEqual([1, 2, 3]);
      expect(monitored.getObject()).toEqual({ foo: "bar" });
      expect(await monitored.getPromise()).toBe("async result");
    });

    it("should handle null and undefined returns", () => {
      const client = {
        getNull: () => null,
        getUndefined: () => undefined,
      };

      const monitored = monitor(client);

      expect(monitored.getNull()).toBeNull();
      expect(monitored.getUndefined()).toBeUndefined();
    });
  });

  describe("Usage Extraction Integration", () => {
    it("should work with OpenAI-style responses", async () => {
      const client = {
        chat: {
          completions: {
            create: async () => ({
              id: "chatcmpl-abc123",
              model: "gpt-4o",
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
              },
              choices: [{ message: { content: "Hello!" } }],
            }),
          },
        },
      };

      const monitored = monitor(client);
      const result = await monitored.chat.completions.create({
        model: "gpt-4o",
        messages: [],
      });

      expect(result.usage.prompt_tokens).toBe(100);
      expect(result.usage.completion_tokens).toBe(50);
    });

    it("should work with Anthropic-style responses", async () => {
      const client = {
        messages: {
          create: async () => ({
            id: "msg_abc123",
            model: "claude-sonnet-4-20250514",
            usage: {
              input_tokens: 200,
              output_tokens: 100,
            },
            content: [{ type: "text", text: "Hello!" }],
          }),
        },
      };

      const monitored = monitor(client);
      const result = await monitored.messages.create({
        model: "claude-sonnet-4-20250514",
        messages: [],
      });

      expect(result.usage.input_tokens).toBe(200);
      expect(result.usage.output_tokens).toBe(100);
    });

    it("should work with @google/generative-ai style responses (wrapped)", async () => {
      // @google/generative-ai SDK returns { response: { usageMetadata: {...} } }
      const client = {
        generateContent: async () => ({
          response: {
            usageMetadata: {
              promptTokenCount: 150,
              candidatesTokenCount: 75,
              totalTokenCount: 225,
            },
            candidates: [
              {
                content: {
                  parts: [{ text: "Hello from Gemini!" }],
                },
              },
            ],
          },
        }),
        model: "gemini-1.5-flash",
      };

      const monitored = monitor(client);
      const result = await monitored.generateContent("Hello!");

      expect(result.response.usageMetadata.promptTokenCount).toBe(150);
      expect(result.response.usageMetadata.candidatesTokenCount).toBe(75);
    });

    it("should work with @google/genai style responses (unwrapped)", async () => {
      // @google/genai SDK returns { usageMetadata: {...} } directly
      const client = {
        models: {
          generateContent: async () => ({
            usageMetadata: {
              promptTokenCount: 200,
              candidatesTokenCount: 100,
              totalTokenCount: 300,
            },
            text: "Hello from Gemini!",
          }),
        },
      };

      const monitored = monitor(client);
      const result = await monitored.models.generateContent({
        model: "gemini-2.0-flash",
        contents: "Hello!",
      });

      expect(result.usageMetadata.promptTokenCount).toBe(200);
      expect(result.usageMetadata.candidatesTokenCount).toBe(100);
    });

    it("should work with Google Vertex AI style responses", async () => {
      const client = {
        generateContent: async () => ({
          usageMetadata: {
            promptTokenCount: 180,
            candidatesTokenCount: 90,
            totalTokenCount: 270,
            cachedContentTokenCount: 50,
          },
          modelVersion: "gemini-1.5-pro-002",
        }),
      };

      const monitored = monitor(client, { provider: "google-vertex" });
      const result = await monitored.generateContent({
        model: "gemini-1.5-pro",
      });

      expect(result.usageMetadata.promptTokenCount).toBe(180);
      expect(result.usageMetadata.cachedContentTokenCount).toBe(50);
    });

    it("should work with @google/generative-ai getGenerativeModel pattern", async () => {
      // This tests the full pattern: genAI.getGenerativeModel() returns a model
      // that has generateContent() which should be wrapped
      const client = {
        getGenerativeModel: ({ model }: { model: string }) => ({
          model,
          generateContent: async () => ({
            response: {
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 60,
                totalTokenCount: 180,
              },
              candidates: [
                {
                  content: {
                    parts: [{ text: "Hello from nested model!" }],
                  },
                },
              ],
            },
          }),
          generateContentStream: async function* () {
            yield { text: "chunk1" };
            yield { text: "chunk2" };
          },
        }),
      };

      const monitored = monitor(client);

      // Get the model - this should return a proxied GenerativeModel
      const model = monitored.getGenerativeModel({ model: "gemini-1.5-flash" });

      // The model's generateContent should be wrapped and tracked
      const result = await model.generateContent("Hello!");

      expect(result.response.usageMetadata.promptTokenCount).toBe(120);
      expect(result.response.usageMetadata.candidatesTokenCount).toBe(60);
    });
  });

  describe("Async Iterator (Streaming) Support", () => {
    it("should handle async iterators", async () => {
      const chunks = ["Hello", " ", "World", "!"];

      const client = {
        stream: async function* (): AsyncGenerator<{ text: string }> {
          for (const chunk of chunks) {
            yield { text: chunk };
          }
        },
      };

      const monitored = monitor(client);
      const stream = await monitored.stream();

      const collected: string[] = [];
      for await (const chunk of stream) {
        collected.push(chunk.text);
      }

      expect(collected).toEqual(chunks);
    });

    it("should handle stream errors", async () => {
      const client = {
        stream: async function* (): AsyncGenerator<{ text: string }> {
          yield { text: "first" };
          throw new Error("Stream error");
        },
      };

      const monitored = monitor(client);
      const stream = await monitored.stream();

      const collected: string[] = [];

      await expect(async () => {
        for await (const chunk of stream) {
          collected.push(chunk.text);
        }
      }).rejects.toThrow("Stream error");

      expect(collected).toEqual(["first"]);
    });

    it("should call onStreamingCost callback on stream completion", async () => {
      const chunks = [
        { text: "Hello" },
        { text: " World" },
        {
          text: "!",
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
      ];

      const client = {
        chat: {
          completions: {
            create: async function* () {
              for (const chunk of chunks) {
                yield chunk;
              }
            },
          },
        },
      };

      const costUpdates: Array<{
        estimatedCost: number;
        inputTokens: number;
        outputTokens: number;
        isComplete: boolean;
      }> = [];

      const monitored = monitor(client, {
        onStreamingCost: (update) => {
          costUpdates.push({ ...update });
        },
      });

      const stream = await monitored.chat.completions.create({
        model: "gpt-4o",
        stream: true,
      });

      for await (const _chunk of stream) {
        // consume stream
      }

      // Should have received at least one update (on completion)
      expect(costUpdates.length).toBeGreaterThanOrEqual(1);

      // Last update should be marked as complete
      const finalUpdate = costUpdates[costUpdates.length - 1];
      expect(finalUpdate.isComplete).toBe(true);
    });

    it("should call onStreamingCost callback on stream error", async () => {
      const client = {
        stream: async function* (): AsyncGenerator<{ text: string }> {
          yield { text: "first" };
          throw new Error("Stream error");
        },
      };

      const costUpdates: Array<{ isComplete: boolean }> = [];

      const monitored = monitor(client, {
        onStreamingCost: (update) => {
          costUpdates.push({ isComplete: update.isComplete });
        },
      });

      const stream = await monitored.stream();

      try {
        for await (const _chunk of stream) {
          // consume
        }
      } catch {
        // expected
      }

      // Should receive a completion callback even on error
      expect(costUpdates.some((u) => u.isComplete)).toBe(true);
    });
  });

  describe("Symbol Properties", () => {
    it("should skip symbol properties", () => {
      const sym = Symbol("test");
      const client = {
        [sym]: "symbol value",
        regular: "regular value",
      };

      const monitored = monitor(client);

      expect(monitored[sym]).toBe("symbol value");
      expect(monitored.regular).toBe("regular value");
    });
  });

  describe("Private Properties", () => {
    it("should skip properties starting with underscore", () => {
      const client = {
        _internal: "private",
        public: "public",
      };

      const monitored = monitor(client);

      expect(monitored._internal).toBe("private");
      expect(monitored.public).toBe("public");
    });
  });

  describe("Hooks", () => {
    describe("beforeRequest", () => {
      it("should call beforeRequest before each API call", async () => {
        const calls: string[] = [];

        const client = {
          chat: {
            completions: {
              create: async () => {
                calls.push("api");
                return {
                  id: "123",
                  usage: { prompt_tokens: 10, completion_tokens: 5 },
                };
              },
            },
          },
        };

        const monitored = monitor(client, {
          beforeRequest: (ctx) => {
            calls.push("beforeRequest");
            expect(ctx.methodPath).toEqual(["chat", "completions", "create"]);
            expect(ctx.spanName).toBe("openai.chat.completions.create");
            expect(ctx.provider).toBe("openai");
          },
        });

        await monitored.chat.completions.create({ model: "gpt-4o" });

        expect(calls).toEqual(["beforeRequest", "api"]);
      });

      it("should support async beforeRequest", async () => {
        const calls: string[] = [];

        const client = {
          call: async () => {
            calls.push("api");
            return { success: true };
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          beforeRequest: async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            calls.push("beforeRequest");
          },
        });

        await monitored.call();

        expect(calls).toEqual(["beforeRequest", "api"]);
      });

      it("should abort request if beforeRequest throws", async () => {
        const apiCalled = vi.fn();

        const client = {
          call: async () => {
            apiCalled();
            return { success: true };
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          beforeRequest: () => {
            throw new Error("Rate limited");
          },
        });

        await expect(monitored.call()).rejects.toThrow("Rate limited");
        expect(apiCalled).not.toHaveBeenCalled();
      });

      it("should abort request if async beforeRequest throws", async () => {
        const apiCalled = vi.fn();

        const client = {
          call: async () => {
            apiCalled();
            return { success: true };
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          beforeRequest: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw new Error("Async rate limit");
          },
        });

        await expect(monitored.call()).rejects.toThrow("Async rate limit");
        expect(apiCalled).not.toHaveBeenCalled();
      });

      it("should provide read-only args in context", async () => {
        const originalArgs = { model: "gpt-4o", messages: [] };

        const client = {
          call: async (args: unknown) => {
            return { args, success: true };
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          beforeRequest: (ctx) => {
            // Args should be readonly
            expect(ctx.args).toEqual([originalArgs]);
          },
        });

        await monitored.call(originalArgs);
      });
    });

    describe("afterResponse", () => {
      it("should call afterResponse after successful API call", async () => {
        const calls: string[] = [];

        const client = {
          chat: {
            completions: {
              create: async () => {
                calls.push("api");
                return {
                  id: "123",
                  model: "gpt-4o",
                  usage: { prompt_tokens: 100, completion_tokens: 50 },
                };
              },
            },
          },
        };

        const monitored = monitor(client, {
          afterResponse: (ctx) => {
            calls.push("afterResponse");
            expect(ctx.methodPath).toEqual(["chat", "completions", "create"]);
            expect(ctx.cost).toBeGreaterThanOrEqual(0);
            expect(ctx.usage).not.toBeNull();
            expect(ctx.usage?.inputUnits).toBe(100);
            expect(ctx.usage?.outputUnits).toBe(50);
            expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
          },
        });

        await monitored.chat.completions.create({ model: "gpt-4o" });

        expect(calls).toEqual(["api", "afterResponse"]);
      });

      it("should support async afterResponse", async () => {
        const calls: string[] = [];

        const client = {
          call: async () => {
            calls.push("api");
            return { success: true };
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          afterResponse: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            calls.push("afterResponse");
          },
        });

        await monitored.call();

        expect(calls).toEqual(["api", "afterResponse"]);
      });

      it("should not throw if afterResponse throws (graceful degradation)", async () => {
        const client = {
          call: async () => ({ success: true }),
        };

        const monitored = monitor(client, {
          provider: "test",
          afterResponse: () => {
            throw new Error("Hook error");
          },
        });

        // Should not throw - hook errors are swallowed
        const result = await monitored.call();
        expect(result).toEqual({ success: true });
      });

      it("should provide correct cost for OpenAI-style responses", async () => {
        let capturedCost = 0;

        const client = {
          chat: {
            completions: {
              create: async () => ({
                model: "gpt-4o",
                usage: { prompt_tokens: 1000, completion_tokens: 500 },
              }),
            },
          },
        };

        const monitored = monitor(client, {
          afterResponse: (ctx) => {
            capturedCost = ctx.cost;
          },
        });

        await monitored.chat.completions.create({ model: "gpt-4o" });

        // Cost should be calculated (exact value depends on pricing manifest)
        expect(capturedCost).toBeGreaterThan(0);
      });

      it("should include result in context", async () => {
        const expectedResult = { id: "123", data: "test" };
        let capturedResult: unknown;

        const client = {
          call: async () => expectedResult,
        };

        const monitored = monitor(client, {
          provider: "test",
          afterResponse: (ctx) => {
            capturedResult = ctx.result;
          },
        });

        await monitored.call();

        expect(capturedResult).toEqual(expectedResult);
      });
    });

    describe("onError", () => {
      it("should call onError when API call fails", async () => {
        const calls: string[] = [];

        const client = {
          call: async () => {
            calls.push("api");
            throw new Error("API failure");
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          onError: (ctx) => {
            calls.push("onError");
            expect(ctx.error.message).toBe("API failure");
            expect(ctx.methodPath).toEqual(["call"]);
            expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
          },
        });

        await expect(monitored.call()).rejects.toThrow("API failure");

        expect(calls).toEqual(["api", "onError"]);
      });

      it("should support async onError", async () => {
        const calls: string[] = [];

        const client = {
          call: async () => {
            calls.push("api");
            throw new Error("API failure");
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          onError: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            calls.push("onError");
          },
        });

        await expect(monitored.call()).rejects.toThrow("API failure");

        expect(calls).toEqual(["api", "onError"]);
      });

      it("should not swallow original error if onError throws", async () => {
        const client = {
          call: async () => {
            throw new Error("Original error");
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          onError: () => {
            throw new Error("Hook error");
          },
        });

        // Should throw original error, not hook error
        await expect(monitored.call()).rejects.toThrow("Original error");
      });
    });

    describe("Hooks with Streaming", () => {
      it("should call afterResponse once at stream end", async () => {
        const afterResponseCalls: number[] = [];

        const client = {
          stream: async function* () {
            yield { text: "chunk1" };
            yield { text: "chunk2" };
            yield {
              text: "chunk3",
              usage: { prompt_tokens: 10, completion_tokens: 20 },
            };
          },
        };

        const monitored = monitor(client, {
          provider: "openai",
          afterResponse: (ctx) => {
            afterResponseCalls.push(ctx.durationMs);
          },
        });

        const stream = await monitored.stream();
        for await (const _chunk of stream) {
          // consume
        }

        // afterResponse should be called exactly once at stream end
        expect(afterResponseCalls.length).toBe(1);
      });

      it("should call onError on stream error", async () => {
        let errorCaptured: Error | null = null;

        const client = {
          stream: async function* () {
            yield { text: "chunk1" };
            throw new Error("Stream failed");
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          onError: (ctx) => {
            errorCaptured = ctx.error;
          },
        });

        const stream = await monitored.stream();

        try {
          for await (const _chunk of stream) {
            // consume
          }
        } catch {
          // expected
        }

        expect(errorCaptured).not.toBeNull();
        expect(errorCaptured?.message).toBe("Stream failed");
      });

      it("should include partial usage in error context for streams", async () => {
        let partialUsage: unknown = null;

        const client = {
          stream: async function* () {
            yield {
              text: "chunk1",
              usage: { prompt_tokens: 5, completion_tokens: 3 },
            };
            throw new Error("Stream failed");
          },
        };

        const monitored = monitor(client, {
          provider: "openai",
          onError: (ctx) => {
            partialUsage = ctx.partialUsage;
          },
        });

        const stream = await monitored.stream();

        try {
          for await (const _chunk of stream) {
            // consume
          }
        } catch {
          // expected
        }

        expect(partialUsage).not.toBeNull();
      });
    });

    describe("Hook Combinations", () => {
      it("should call all hooks in correct order", async () => {
        const calls: string[] = [];

        const client = {
          call: async () => {
            calls.push("api");
            return { success: true };
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          beforeRequest: () => {
            calls.push("beforeRequest");
          },
          afterResponse: () => {
            calls.push("afterResponse");
          },
        });

        await monitored.call();

        expect(calls).toEqual(["beforeRequest", "api", "afterResponse"]);
      });

      it("should call onError instead of afterResponse on failure", async () => {
        const calls: string[] = [];

        const client = {
          call: async () => {
            calls.push("api");
            throw new Error("Failed");
          },
        };

        const monitored = monitor(client, {
          provider: "test",
          beforeRequest: () => {
            calls.push("beforeRequest");
          },
          afterResponse: () => {
            calls.push("afterResponse");
          },
          onError: () => {
            calls.push("onError");
          },
        });

        await expect(monitored.call()).rejects.toThrow("Failed");

        expect(calls).toEqual(["beforeRequest", "api", "onError"]);
        expect(calls).not.toContain("afterResponse");
      });
    });
  });

  describe("withCost Utility", () => {
    it("should capture cost from monitored API call", async () => {
      const client = {
        chat: {
          completions: {
            create: async () => ({
              id: "123",
              model: "gpt-4o",
              usage: { prompt_tokens: 100, completion_tokens: 50 },
              choices: [{ message: { content: "Hello!" } }],
            }),
          },
        },
      };

      const monitored = monitor(client);

      const { result, cost, usage } = await withCost(() =>
        monitored.chat.completions.create({ model: "gpt-4o" })
      );

      expect(result.id).toBe("123");
      expect(cost).toBeGreaterThanOrEqual(0);
      expect(usage).not.toBeNull();
      expect(usage?.inputUnits).toBe(100);
      expect(usage?.outputUnits).toBe(50);
    });

    it("should capture cost from multiple calls", async () => {
      const client = {
        chat: {
          completions: {
            create: async () => ({
              model: "gpt-4o",
              usage: { prompt_tokens: 50, completion_tokens: 25 },
            }),
          },
        },
      };

      const monitored = monitor(client);

      const { result, cost } = await withCost(async () => {
        const r1 = await monitored.chat.completions.create({ model: "gpt-4o" });
        const r2 = await monitored.chat.completions.create({ model: "gpt-4o" });
        return { r1, r2 };
      });

      expect(result.r1).toBeDefined();
      expect(result.r2).toBeDefined();
      // Cost should be set (last call's cost in this implementation)
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it("should return zero cost when no usage data", async () => {
      const client = {
        call: async () => ({ success: true }),
      };

      const monitored = monitor(client, { provider: "test" });

      const { result, cost, usage } = await withCost(() => monitored.call());

      expect(result.success).toBe(true);
      expect(cost).toBe(0);
      expect(usage).toBeNull();
    });

    it("should work with streaming responses", async () => {
      const client = {
        stream: async function* () {
          yield { text: "chunk1" };
          yield { text: "chunk2" };
          yield {
            text: "chunk3",
            usage: { prompt_tokens: 20, completion_tokens: 10 },
          };
        },
      };

      const monitored = monitor(client, { provider: "openai" });

      const { cost, usage } = await withCost(async () => {
        const stream = await monitored.stream();
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        return chunks;
      });

      // Cost should be captured from stream completion
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });
});
