import { WebSocket } from "ws";
import {
  RTClient,
  RTResponse,
  RTInputAudioItem,
  RTTextContent,
  RTAudioContent,
} from "rt-client";
import { AzureKeyCredential } from "@azure/core-auth";
import { Logger } from "pino";

interface TextDelta {
  id: string;
  type: "text_delta";
  delta: string;
}

interface Transcription {
  id: string;
  type: "transcription";
  text: string;
}

interface UserMessage {
  id: string;
  type: "user_message";
  text: string;
}

interface SpeechStarted {
  type: "control";
  action: "speech_started";
}

interface Connected {
  type: "control";
  action: "connected";
  greeting: string;
}

interface TextDone {
  type: "control";
  action: "text_done";
  id: string;
}

type ControlMessage = SpeechStarted | Connected | TextDone;

type WSMessage = TextDelta | Transcription | UserMessage | ControlMessage;

/**
 * Represents a real-time session that manages communication with a client through a WebSocket connection.
 * It handles audio and text messages, interacts with an RTClient for processing, and manages the session lifecycle.
 */
export class RTSession {
  private client: RTClient;
  private ws: WebSocket;
  private readonly sessionId: string;
  private logger: Logger;

  /**
   * Creates a new RTSession instance.
   * @param ws The WebSocket instance for communicating with the client.
   * @param backend The backend type to use (e.g., "azure").
   * @param logger The logger instance for logging session activities.
   */
  constructor(ws: WebSocket, backend: string | undefined, logger: Logger) {
    this.sessionId = crypto.randomUUID();
    this.ws = ws;
    this.logger = logger.child({ sessionId: this.sessionId });
    this.client = this.initializeClient(backend);
    this.setupEventHandlers();

    this.logger.info("New session created");
    this.initialize();
  }

  /**
   * Initializes the real-time session by configuring the RTClient, sending a greeting message, and starting the event loop.
   */
  async initialize() {
    this.logger.debug("Configuring realtime session");
    await this.client.configure({
      modalities: ["text", "audio"],
      input_audio_format: "pcm16",
      input_audio_transcription: {
        model: "whisper-1",
      },
      turn_detection: {
        type: "server_vad",
      },
    });

    this.logger.debug("Realtime session configured successfully");
    /* Send greeting */
    const greeting: Connected = {
      type: "control",
      action: "connected",
      greeting: "You are now connected to the a expressjs server",
    };
    this.send(greeting);
    this.logger.debug("Realtime session configured successfully");
    this.startEventLoop();
  }

  /**
   * Sends a message to the client via the WebSocket connection.
   * @param message The message to send (must be serializable to JSON).
   */
  private send(message: WSMessage) {
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Sends a binary message to the client via the WebSocket connection.
   * @param message The binary message to send.
   */
  private sendBinary(message: ArrayBufferLike) {
    this.ws.send(Buffer.from(message), { binary: true });
  }

  /**
   * Initializes the RTClient based on the specified backend.
   * @param backend The backend type to use (e.g., "azure").
   * @returns An instance of RTClient configured for the specified backend.
   */
  private initializeClient(backend: string | undefined): RTClient {
    this.logger.debug({ backend }, "Initializing RT client");

    if (backend === "azure") {
      return new RTClient(
        new URL(process.env.AZURE_OPENAI_ENDPOINT!),
        new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY!),
        { deployment: process.env.AZURE_OPENAI_DEPLOYMENT! },
      );
    }
    return new RTClient(new AzureKeyCredential(process.env.OPENAI_API_KEY!), {
      model: process.env.OPENAI_MODEL!,
    });
  }

  /**
   * Sets up event handlers for WebSocket events (message, close, error).
   */
  private setupEventHandlers() {
    this.logger.debug("Client configured successfully");

    this.ws.on("message", this.handleMessage.bind(this));
    this.ws.on("close", this.handleClose.bind(this));
    this.ws.on("error", (error) => {
      this.logger.error({ error }, "WebSocket error occurred");
    });
  }

  /**
   * Handles incoming messages from the WebSocket, routing them based on whether they are binary or text.
   * @param message The incoming message.
   * @param isBinary Indicates whether the message is binary data.
   */
  private async handleMessage(message: Buffer, isBinary: boolean) {
    try {
      if (isBinary) {
        await this.handleBinaryMessage(message);
      } else {
        await this.handleTextMessage(message);
      }
    } catch (error) {
      this.logger.error({ error }, "Error handling message");
    }
  }

  /**
   * Handles incoming binary messages, typically audio data, by sending them to the RTClient.
   * @param message The binary message containing audio data.
   */
  private async handleBinaryMessage(message: Buffer) {
    try {
      await this.client.sendAudio(new Uint8Array(message));
    } catch (error) {
      this.logger.error({ error }, "Failed to send audio data");
      throw error;
    }
  }

  /**
   * Handles incoming text messages, processing user messages and sending them to the RTClient.
   * @param message The text message received.
   */
  private async handleTextMessage(message: Buffer) {
    const messageString = message.toString("utf-8");
    const parsed: WSMessage = JSON.parse(messageString);

    this.logger.debug({ messageType: parsed.type }, "Received text message");

    if (parsed.type === "user_message") {
      try {
        await this.client.sendItem({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: parsed.text }],
        });
        await this.client.generateResponse();
        this.logger.debug("User message processed successfully");
      } catch (error) {
        this.logger.error({ error }, "Failed to process user message");
        throw error;
      }
    }
  }

  /**
   * Handles the WebSocket close event, closing the RTClient connection.
   */
  private async handleClose() {
    this.logger.info("Session closing");
    try {
      await this.client.close();
      this.logger.info("Session closed successfully");
    } catch (error) {
      this.logger.error({ error }, "Error closing session");
    }
  }

  /**
   * Handles RTTextContent, sending text deltas and completion signals to the client.
   * @param content The text content received from the RTClient.
   */
  private async handleTextContent(content: RTTextContent) {
    try {
      const contentId = `${content.itemId}-${content.contentIndex}`;
      for await (const text of content.textChunks()) {
        const deltaMessage: TextDelta = {
          id: contentId,
          type: "text_delta",
          delta: text,
        };
        this.send(deltaMessage);
      }
      this.send({ type: "control", action: "text_done", id: contentId });
      this.logger.debug("Text content processed successfully");
    } catch (error) {
      this.logger.error({ error }, "Error handling text content");
      throw error;
    }
  }

  /**
   * Handles RTAudioContent, sending audio and transcription data to the client.
   * @param content The audio content received from the RTClient.
   */
  private async handleAudioContent(content: RTAudioContent) {
    const handleAudioChunks = async () => {
      for await (const chunk of content.audioChunks()) {
        this.sendBinary(chunk.buffer);
      }
    };
    const handleAudioTranscript = async () => {
      const contentId = `${content.itemId}-${content.contentIndex}`;
      for await (const chunk of content.transcriptChunks()) {
        this.send({ id: contentId, type: "text_delta", delta: chunk });
      }
      this.send({ type: "control", action: "text_done", id: contentId });
    };

    try {
      await Promise.all([handleAudioChunks(), handleAudioTranscript()]);
      this.logger.debug("Audio content processed successfully");
    } catch (error) {
      this.logger.error({ error }, "Error handling audio content");
      throw error;
    }
  }

  /**
   * Handles RTResponse events, processing each item and content type within the response.
   * @param event The RTResponse event received from the RTClient.
   */
  private async handleResponse(event: RTResponse) {
    try {
      for await (const item of event) {
        if (item.type === "message") {
          for await (const content of item) {
            if (content.type === "text") {
              await this.handleTextContent(content);
            } else if (content.type === "audio") {
              await this.handleAudioContent(content);
            }
          }
        }
      }
      this.logger.debug("Response handled successfully");
    } catch (error) {
      this.logger.error({ error }, "Error handling response");
      throw error;
    }
  }

  /**
   * Handles RTInputAudioItem events, sending transcription and completion information to the client.
   * @param event The input audio event received from the RTClient.
   */
  private async handleInputAudio(event: RTInputAudioItem) {
    try {
      this.send({ type: "control", action: "speech_started" });
      await event.waitForCompletion();

      const transcription: Transcription = {
        id: event.id,
        type: "transcription",
        text: event.transcription || "",
      };
      this.send(transcription);
      this.logger.debug(
        { transcriptionLength: transcription.text.length },
        "Input audio processed successfully",
      );
    } catch (error) {
      this.logger.error({ error }, "Error handling input audio");
      throw error;
    }
  }

  /**
   * Starts the main event loop, listening for events from the RTClient and handling them.
   */
  private async startEventLoop() {
    try {
      this.logger.debug("Starting event loop");
      for await (const event of this.client.events()) {
        if (event.type === "response") {
          await this.handleResponse(event);
        } else if (event.type === "input_audio") {
          await this.handleInputAudio(event);
        }
      }
    } catch (error) {
      this.logger.error({ error }, "Error in event loop");
      throw error;
    }
  }
}
