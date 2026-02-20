const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export const DriveAPI = {
  async listFiles(token: string): Promise<DriveFile[]> {
    const allFiles: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'nextPageToken,files(id,name,modifiedTime)',
        pageSize: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const resp = await fetch(`${DRIVE_API}/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        throw new Error(`Drive listFiles failed: ${resp.status}`);
      }

      const data = await resp.json() as { files?: DriveFile[]; nextPageToken?: string };
      if (data.files) allFiles.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
  },

  async getFile<T = unknown>(token: string, fileId: string): Promise<T> {
    const resp = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      throw new Error(`Drive getFile failed: ${resp.status}`);
    }

    return resp.json() as Promise<T>;
  },

  async createFile(token: string, name: string, content: unknown): Promise<string> {
    const metadata = {
      name,
      parents: ['appDataFolder'],
    };

    const boundary = '---mikukotoba_boundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(content),
      `--${boundary}--`,
    ].join('\r\n');

    const resp = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!resp.ok) {
      throw new Error(`Drive createFile failed: ${resp.status}`);
    }

    const data = await resp.json() as { id: string };
    return data.id;
  },

  async updateFile(token: string, fileId: string, content: unknown): Promise<void> {
    const resp = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(content),
    });

    if (!resp.ok) {
      throw new Error(`Drive updateFile failed: ${resp.status}`);
    }
  },

  async findFileByName(token: string, name: string): Promise<string | null> {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name='${name}'`,
      fields: 'files(id)',
      pageSize: '1',
    });

    const resp = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      throw new Error(`Drive findFileByName failed: ${resp.status}`);
    }

    const data = await resp.json() as { files?: { id: string }[] };
    return data.files?.[0]?.id || null;
  },
};
