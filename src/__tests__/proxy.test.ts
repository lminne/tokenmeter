/**
 * Tests for the monitor (Proxy) function
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { monitor } from "../instrumentation/proxy.js";

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
    it("should propagate sync errors", () => {
      const client = {
        failSync: () => {
          throw new Error("Sync error");
        },
      };

      const monitored = monitor(client);

      expect(() => monitored.failSync()).toThrow("Sync error");
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
  });

  describe("Async Iterator (Streaming) Support", () => {
    it("should handle async iterators", async () => {
      const chunks = ["Hello", " ", "World", "!"];
      let index = 0;

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
});
