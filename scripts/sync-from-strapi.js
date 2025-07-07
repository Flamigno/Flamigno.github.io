const axios = require('axios');
const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { pinyin } = require('pinyin');
const Pinyin = require('pinyin');

// --- 配置 ---
// 您的 Strapi 服务器地址。
// 注意：当您将 Strapi 部署到云服务器后，需要将 'http://localhost:1337' 替换为您的公网 IP 地址。
const STRAPI_API_URL = process.env.STRAPI_API_URL || 'http://localhost:1337';
// 您 Hexo 项目中存放文章的目录。
const POSTS_DIR = path.join(__dirname, '..', 'source', '_posts');

// --- Strapi Blocks JSON 到 Markdown 的转换器 ---
function blocksToMarkdown(blocks) {
  let markdown = '';
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        markdown += block.children.map(child => child.text).join('') + '\n\n';
        break;
      case 'heading':
        markdown += '#'.repeat(block.level) + ' ' + block.children.map(child => child.text).join('') + '\n\n';
        break;
      case 'list':
        const listChar = block.format === 'ordered' ? '1. ' : '- ';
        markdown += block.children.map(listItem => listChar + listItem.children.map(child => child.text).join('')).join('\n') + '\n\n';
        break;
      case 'quote':
        markdown += '> ' + block.children.map(child => child.text).join('') + '\n\n';
        break;
      case 'image':
        // 确保图片 URL 是完整的。Strapi 的 URL 可能不包含主机名。
        const imageUrl = block.image.url.startsWith('http') ? block.image.url : `http://localhost:1337${block.image.url}`;
        markdown += `![${block.image.alternativeText || ''}](${imageUrl})\n\n`;
        break;
      case 'code':
         markdown += '```' + (block.language || '') + '\n' + block.children.map(child => child.text).join('\n') + '\n```\n\n';
        break;
      default:
        console.warn(`未知的块类型: ${block.type}`);
    }
  }
  return markdown;
}

// --- 主执行函数 ---
async function syncPosts() {
  console.log('🚀 开始从 Strapi 同步文章...');

  try {
    // 1. 清空旧文章目录
    console.log('🗑️  正在清空旧的文章...');
    if (fs.existsSync(POSTS_DIR)) {
      fs.rmSync(POSTS_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(POSTS_DIR, { recursive: true });
    console.log('✅ 旧文章已清空。');

    // 2. 从 Strapi API 获取文章数据，并按发布日期降序排序
    console.log('📡 正在从 Strapi 获取文章数据...');
    const response = await axios.get(`${STRAPI_API_URL}/api/articles`, {
      params: {
        populate: '*',
        sort: 'publishedAt:desc'
      }
    });
    const articles = response.data.data;

    if (!articles || articles.length === 0) {
      console.log('🤷 未在 Strapi 中找到任何已发布的文章。');
      return;
    }
    console.log(`✨ 成功获取到 ${articles.length} 篇文章。`);

    // 3. 循环处理每篇文章并生成 .md 文件
    console.log('✍️  正在生成 Markdown 文件...');
    for (const article of articles) {
      // 注意：我们直接从 article 对象获取属性，因为您的 API 响应似乎是扁平化的。
      let slug = article.slug; // 优先使用从 API 获取的 slug

      // 如果 slug 为空，则根据标题+ID生成一个唯一的、URL友好的 slug
      if (!slug) {
        const pinyinTitle = pinyin(article.title, {
          style: pinyin.STYLE_NORMAL,
        }).join(' ');

        slug = slugify(`${pinyinTitle} ${article.id}`, { lower: true, strict: true });
        console.warn(`  - ⚠️  文章 "${article.title}" 的 slug 为空，已根据标题和ID自动生成: ${slug}`);
      }

      // 智能处理封面图 URL
      let coverImageSrc = null;
      if (article.coverImage && article.coverImage.url) {
        const coverUrl = article.coverImage.url;
        // 如果 URL 已经是完整的 http/https 链接，则直接使用
        if (coverUrl.startsWith('http')) {
            coverImageSrc = coverUrl;
        } else {
            // 否则，拼接上 Strapi 服务器地址
            coverImageSrc = `http://localhost:1337${coverUrl}`;
        }
      }

      // 构建 Front-matter
      const frontmatter = {
        title: article.title,
        date: new Date(article.publishedAt).toISOString().replace('T', ' ').substring(0, 19),
        // 如果有分类，则使用分类名
        ...(article.category && { categories: article.category.name }),
        // 如果有封面图，则使用处理好的 URL
        ...(coverImageSrc && { img: coverImageSrc }),
      };
      
      let frontmatterString = '---\n';
      for (const key in frontmatter) {
        frontmatterString += `${key}: ${JSON.stringify(frontmatter[key])}\n`;
      }
      frontmatterString += '---\n\n';
      
      // 转换正文内容
      const markdownContent = blocksToMarkdown(article.content);
      
      // 组合并写入文件
      const finalContent = frontmatterString + markdownContent;
      const filePath = path.join(POSTS_DIR, `${slug}.md`);
      fs.writeFileSync(filePath, finalContent);

      console.log(`   -> 已创建: ${slug}.md`);
    }

    console.log('🎉 同步完成！所有文章已成功生成。');

  } catch (error) {
    console.error('❌ 同步过程中发生错误:');
    if (error.response) {
      console.error('   - API 响应错误:', error.response.status, error.response.statusText);
    } else if (error.request) {
      console.error('   - 无法连接到 Strapi 服务器。请确保 Strapi 正在运行，并且 API 地址正确。');
    } else {
      console.error('   - 脚本错误:', error.message);
    }
    process.exit(1); // 以错误码退出
  }
}

// 运行同步函数
syncPosts(); 