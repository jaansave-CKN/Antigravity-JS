/**
 * Antigravity Skill: CONECTOR_DATOS_EXTERNOS
 * Feature: Trello Interconnection - Full API v1
 */
export class TrelloProvider {
  constructor(apiKey, token) {
    this.apiKey = apiKey;
    this.token = token;
    this.baseUrl = 'https://api.trello.com/1';
  }

  async getBoards() {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/members/me/boards?key=${this.apiKey}&token=${this.token}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TrelloProvider] API Error:', errorText);
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async getLists(boardId) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/boards/${boardId}/lists?key=${this.apiKey}&token=${this.token}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async getCards(listId) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/lists/${listId}/cards?key=${this.apiKey}&token=${this.token}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async createCard(listId, name, desc = '') {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/cards?key=${this.apiKey}&token=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idList: listId, name, desc })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async updateCard(cardId, updates) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const params = new URLSearchParams({ key: this.apiKey, token: this.token });
    const response = await fetch(`${this.baseUrl}/cards/${cardId}?${params}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async getBoardCards(boardId) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/boards/${boardId}/cards?key=${this.apiKey}&token=${this.token}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async getLabels(boardId) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/boards/${boardId}/labels?key=${this.apiKey}&token=${this.token}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async addLabelToCard(cardId, labelId) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/cards/${cardId}/idLabels?key=${this.apiKey}&token=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: labelId })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return await response.json();
  }

  async deleteCard(cardId) {
    if (!this.apiKey || !this.token) {
      throw new Error('Trello credentials not configured');
    }

    const response = await fetch(`${this.baseUrl}/cards/${cardId}?key=${this.apiKey}&token=${this.token}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('invalid key')) {
        throw new Error('CREDENTIALS_EXPIRED: Trello API key is invalid. Generate new at https://trello.com/app-key');
      }
      throw new Error(errorText || 'Trello API Error');
    }

    return { success: true };
  }
}
