import { QwenImageRerankerService } from './qwen-image-reranker.service';

type TestableService = {
  supportsVisionInput(): Promise<boolean>;
  callOllama(
    prompt: string,
    candidate: { imagePath: string },
    useImageInput: boolean,
  ): Promise<string>;
  readImageAsBase64(path: string): string | undefined;
};

describe('QwenImageRerankerService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = {
      ...originalEnv,
      RAG_QWEN_RERANKER_MODEL: 'qwen2.5:7b',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('detecta modelo sem vision antes de enviar imagens', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ capabilities: ['completion', 'tools'] }),
          { status: 200 },
        ),
      );
    const service =
      new QwenImageRerankerService() as unknown as TestableService;

    await expect(service.supportsVisionInput()).resolves.toBe(false);
    await expect(service.supportsVisionInput()).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/show',
      expect.objectContaining({
        body: JSON.stringify({ model: 'qwen2.5:7b' }),
      }),
    );
  });

  it('envia base64 somente quando o modelo suporta vision', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { content: '{}' } }), {
        status: 200,
      }),
    );
    const service =
      new QwenImageRerankerService() as unknown as TestableService;
    jest
      .spyOn(service, 'readImageAsBase64')
      .mockReturnValue('imagem-em-base64');

    await service.callOllama('pergunta', { imagePath: '/tmp/page.png' }, true);

    const request = jest.mocked(global.fetch).mock.calls[0][1];
    const requestBody = request?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') {
      throw new Error('Corpo JSON da requisicao nao encontrado.');
    }
    const body = JSON.parse(requestBody) as {
      messages: Array<{ images?: string[] }>;
    };
    expect(body.messages[0].images).toEqual(['imagem-em-base64']);
  });

  it('inclui o erro retornado pelo Ollama no diagnostico', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'qwen2.5:7b does not support images' }),
          { status: 400 },
        ),
      );
    const service =
      new QwenImageRerankerService() as unknown as TestableService;

    await expect(
      service.callOllama('pergunta', { imagePath: '' }, false),
    ).rejects.toThrow('does not support images');
  });
});
